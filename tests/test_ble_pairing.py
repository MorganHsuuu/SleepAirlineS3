import argparse
import asyncio
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from subprocess import CompletedProcess, TimeoutExpired
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hardware'))
import device_kiosk as dk
from ble_protocol import key, seal, unseal, frames, Assembler, Session
from ble_server import Service, Characteristic, Advertisement, BleServer

V = json.loads(Path(__file__).with_name('ble-vector.json').read_text())

class CodecTests(unittest.TestCase):
    def test_cross_language_vector(self):
        k = key(V['secret'], bytes.fromhex(V['salt']), V['deviceId'], 'c2d')
        self.assertEqual(k.hex(), V['key'])
        self.assertEqual(seal(k, V['payload'], bytes.fromhex(V['nonce'])).hex(), V['ciphertext'])
        self.assertEqual(unseal(k, bytes.fromhex(V['ciphertext'])), V['payload'])
        with self.assertRaises(Exception): unseal(key('wrong', bytes.fromhex(V['salt']), V['deviceId'], 'c2d'), bytes.fromhex(V['ciphertext']))
        damaged = bytearray.fromhex(V['ciphertext']); damaged[-1] ^= 1
        with self.assertRaises(Exception): unseal(k, bytes(damaged))
    def test_fragment_order_and_bounds(self):
        a = Assembler(); data = bytes(range(256)) * 32
        result = None
        for packet in frames(data):
            self.assertLessEqual(len(packet), 20); result = a.feed(packet)
        self.assertEqual(result, data)
        packets = list(frames(data)); a.feed(packets[0])
        with self.assertRaises(ValueError): a.feed(packets[2])
        with self.assertRaises(ValueError): list(frames(data + b'x'))
    def test_session_replay_and_reconnect(self):
        a = Session(V['deviceId'], V['secret'], time.time()+60)
        b = Session(V['deviceId'], V['secret'], time.time()+60)
        request = seal(a.read_key, {'id':1, 'op':'hello'})
        a.request(request)
        with self.assertRaises(ValueError): a.request(request)
        with self.assertRaises(Exception): b.request(request)
        with self.assertRaises(ValueError): a.request(seal(a.read_key, {'id':True, 'op':'hello'}))
    def test_bluez_dbus_interfaces_can_be_exported(self):
        for interface in [Service(), Characteristic(None, 'info', 'test', ['read']), Advertisement('SA-12345678')]:
            self.assertTrue(interface.introspect().name.startswith('org.bluez.'))

class KioskBleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        patcher = patch.object(dk, 'STATE_FILE', Path(self.directory.name)/'device.json'); patcher.start(); self.addCleanup(patcher.stop)
        self.kiosk = dk.Kiosk(argparse.Namespace(dry_run=True, interface='wlan0', reconfigure_wifi=False))
        self.kiosk.start_setup()
    def test_default_is_ble_without_hotspot_and_setup_secret_persists(self):
        self.assertEqual(self.kiosk.transport, 'ble')
        self.assertNotIn('hotspotPassword', self.kiosk.state)
        code = self.kiosk.state['setupCode']; self.kiosk.start_setup()
        self.assertEqual(code, self.kiosk.state['setupCode'])
        self.assertIn('其他連線方式', self.kiosk.device_page())
        self.assertIn('介面預覽', self.kiosk.device_page())
    def test_validation_uses_utf8_bytes(self):
        self.assertTrue(self.kiosk.valid_provision({'ssid':'教室', 'password':'', 'grant':'test'}))
        self.assertFalse(self.kiosk.valid_provision({'ssid':'教'*11, 'password':'', 'grant':'test'}))
        self.assertFalse(self.kiosk.valid_provision({'ssid':'abc\0def', 'password':'', 'grant':'test'}))
    def test_wrong_wifi_retains_ble_and_qr(self):
        k = self.kiosk; code = k.state['setupCode']; k.args.dry_run = False
        with patch.object(dk.subprocess, 'run', return_value=CompletedProcess([],1,'','')), patch.object(k, 'start_hotspot') as ap:
            k._provision_worker('test','wrong','grant')
        ap.assert_not_called(); self.assertEqual(k.status,'error'); self.assertEqual(k.error_code,'wifi_failed')
        self.assertEqual(k.state['setupCode'], code)
    def test_timeout_has_no_secrets_in_logs(self):
        k = self.kiosk; k.args.dry_run = False
        with patch.object(dk.subprocess, 'run', side_effect=TimeoutExpired(['nmcli','password','DO-NOT-LOG'],75)), patch('sys.stderr') as err:
            k._provision_worker('test','DO-NOT-LOG','grant')
        self.assertNotIn('DO-NOT-LOG',str(err.write.call_args_list)); self.assertFalse(k.busy)
    def test_success_reconnect_receipt_is_temporary(self):
        k=self.kiosk; code=k.state['setupCode']; k._provision_worker('test','test','grant')
        self.assertTrue(k.ble_status()['paired']); self.assertFalse(k.accepting_ble()); self.assertEqual(k.ble_material()[0],code)
        self.assertNotIn('setupCode', k.state)
        server=BleServer(k); session=server.session('/device/phone')
        self.assertEqual(session.setup_code,code)
        k.ble_receipt=(code,time.time()-1); self.assertIsNone(k.ble_material())
    def test_network_scan_deduplicates_and_handles_colons(self):
        self.kiosk.args.dry_run=False
        output='Home\\:Desk:WPA2:80\nHome\\:Desk:WPA2:20\nCampus:WPA2 802.1X:90\nGuest:--:50\n'
        with patch.object(dk.subprocess,'run',return_value=CompletedProcess([],0,output,'')):
            networks=self.kiosk.wifi_networks()
        self.assertEqual([n['ssid'] for n in networks],['Campus','Home:Desk','Guest'])
        self.assertTrue(networks[0]['enterprise']); self.assertFalse(networks[-1]['secure'])
    def test_cloud_retry_keeps_current_wifi_without_reconnecting(self):
        k = self.kiosk; k.args.dry_run = False
        k.confirmed_ssid, k.confirmed_uuid, k.error_code = 'Home', 'saved-uuid', 'cloud_unavailable'
        calls = []
        def nmcli(cmd, **kwargs):
            calls.append(cmd)
            return CompletedProcess(cmd, 0, 'saved-uuid\n', '')
        with patch.object(dk.subprocess, 'run', side_effect=nmcli), patch.object(dk, 'cloud_post', return_value={'passengerId': 'PAX-TEST0001'}):
            k._provision_worker('Home', 'password', 'new-grant', skip_wifi=True)
        self.assertEqual(k.status, 'paired')
        self.assertFalse(any('connect' in cmd for cmd in calls))

    def test_cloud_failure_keeps_ble_and_binding_for_retry(self):
        k=self.kiosk; k.args.dry_run=False
        def nmcli(cmd,**kwargs): return CompletedProcess(cmd,0,'uuid' if 'GENERAL.CON-UUID' in cmd else '','')
        with patch.object(dk.subprocess,'run',side_effect=nmcli), patch.object(dk,'cloud_post',side_effect=URLError('offline')), patch.object(dk.time,'sleep'), patch.object(k,'start_hotspot') as ap:
            k._provision_worker('test','password','grant')
        ap.assert_not_called(); self.assertEqual(k.error_code,'cloud_unavailable'); self.assertFalse(k.busy)

if __name__ == '__main__': unittest.main()
