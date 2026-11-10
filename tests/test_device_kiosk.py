import argparse
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location('device_kiosk', Path(__file__).resolve().parents[1] / 'hardware/device_kiosk.py')
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        state = patch.object(k, 'STATE_FILE', Path(self.directory.name) / 'device.json')
        state.start(); self.addCleanup(state.stop)
        self.kiosk = k.Kiosk(argparse.Namespace(dry_run=True, interface='wlan0', reconfigure_wifi=False))
        self.kiosk.ensure_setup_code()
        self.networks = [{'ssid': 'Home not nearby', 'password': 'password123'}]

    def test_hotspot_retries_keep_qr_until_expiry(self):
        self.kiosk.start_hotspot()
        first = dict(self.kiosk.state)
        self.kiosk.start_hotspot()
        self.assertEqual(first, self.kiosk.state)
        self.kiosk.state['setupExpires'] = 0
        self.kiosk.start_hotspot()
        self.assertNotEqual(first['setupCode'], self.kiosk.state['setupCode'])

    def test_class_lan_stays_connected_while_saving_future_home_and_binding(self):
        self.kiosk.setup_mode = 'lan'
        self.kiosk.args.dry_run = False
        self.kiosk.wifi = Mock()
        self.kiosk.wifi.current.return_value = {'ssid': 'T2-308教室'}
        with patch.object(k, 'cloud_post', side_effect=[URLError('DNS'), {'passengerId': 'PAX-TEST0001'}]) as cloud, patch.object(k.time, 'sleep'):
            self.kiosk._provision_worker(self.networks, 'grant', False)
        self.kiosk.wifi.save.assert_called_once_with(self.networks)
        self.kiosk.wifi.connect_saved.assert_not_called()
        self.assertEqual(cloud.call_count, 2)
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-TEST0001')
        self.assertNotIn('password123', k.STATE_FILE.read_text())
        self.assertNotIn('setupCode', self.kiosk.state)

    def test_all_saved_networks_fail_and_hotspot_retry_preserves_binding(self):
        self.kiosk.state.update(passengerId='PAX-EXISTING', passengerName='旅客')
        self.kiosk.reconfiguring = True
        self.kiosk.wifi = Mock()
        self.kiosk.wifi.connect_saved.return_value = None
        code = self.kiosk.state['setupCode']
        with patch.object(k, 'cloud_post') as cloud, patch.object(k.time, 'sleep'):
            self.kiosk._provision_worker(self.networks, '', True)
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-EXISTING')
        self.assertEqual(self.kiosk.state['setupCode'], code)
        self.assertEqual(self.kiosk.status, 'ready')
        self.assertFalse(self.kiosk.busy)
        cloud.assert_not_called()
        with patch.object(k, 'Thread'):
            self.assertTrue(self.kiosk.provision('', '', '', code, networks=self.networks))
            self.assertFalse(self.kiosk.provision('', '', '', code, networks=self.networks))

    def test_paired_network_recovery_never_rebinds_or_needs_grant(self):
        self.kiosk.state.update(passengerId='PAX-EXISTING', passengerName='旅客')
        self.kiosk.reconfiguring = True
        with patch.object(self.kiosk, 'check_cloud') as check, patch.object(k.time, 'sleep'):
            self.kiosk._provision_worker(self.networks, '', True)
        check.assert_called_once()
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-EXISTING')
        self.assertEqual(self.kiosk.state['passengerName'], '旅客')
        self.assertFalse(self.kiosk.reconfiguring)

    def test_boot_all_failed_opens_network_only_recovery(self):
        self.kiosk.state['passengerId'] = 'PAX-EXISTING'
        self.kiosk.wifi = Mock()
        self.kiosk.wifi.connect_saved.return_value = None
        self.kiosk.initialize_network()
        self.assertTrue(self.kiosk.reconfiguring)
        self.assertEqual(self.kiosk.setup_mode, 'hotspot')
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-EXISTING')

    def test_boot_tries_saved_and_only_checks_cloud_after_success(self):
        self.kiosk.state['passengerId'] = 'PAX-EXISTING'
        self.kiosk.wifi = Mock()
        self.kiosk.wifi.connect_saved.return_value = {'ssid': 'Home', 'address': '192.168.0.3'}
        with patch.object(self.kiosk, 'check_cloud') as check:
            self.kiosk.initialize_network()
        check.assert_called_once()
        self.assertFalse(self.kiosk.reconfiguring)
        self.assertEqual(self.kiosk.setup_mode, 'lan')

    def test_cloud_outage_with_wifi_keeps_binding_without_forcing_hotspot(self):
        self.kiosk.args.dry_run = False
        self.kiosk.state['passengerId'] = 'PAX-EXISTING'
        self.kiosk.wifi = Mock()
        self.kiosk.wifi.current.return_value = {'ssid': 'Home'}
        with patch.object(k, 'cloud_post', side_effect=URLError('offline')), patch.object(self.kiosk, 'start_hotspot') as hotspot:
            self.kiosk.monitor_once()
        hotspot.assert_not_called()
        self.assertFalse(self.kiosk.online)
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-EXISTING')

    def test_expired_or_wrong_code_and_missing_initial_grant_cannot_provision(self):
        with patch.object(k, 'Thread') as thread:
            self.assertFalse(self.kiosk.provision('', '', 'grant', 'wrong', networks=self.networks))
            with self.assertRaises(ValueError):
                self.kiosk.provision('', '', '', self.kiosk.state['setupCode'], networks=self.networks)
            self.kiosk.state['setupExpires'] = 0
            self.assertFalse(self.kiosk.provision('', '', 'grant', self.kiosk.state['setupCode'], networks=self.networks))
        thread.assert_not_called()

    def test_mode_switch_invalidates_old_page_revision_but_retains_identity(self):
        self.kiosk.state['passengerId'] = 'PAX-EXISTING'
        revision = self.kiosk.state['setupRevision']
        self.kiosk._mode_worker('lan')
        self.assertEqual(self.kiosk.setup_mode, 'lan')
        self.assertGreater(self.kiosk.state['setupRevision'], revision)
        self.assertEqual(self.kiosk.state['passengerId'], 'PAX-EXISTING')

    def test_empty_cloud_name_does_not_erase_saved_name(self):
        self.kiosk.state.update(passengerId='PAX-EXISTING', passengerName='小明')
        self.kiosk.apply_cloud_identity({'status': 'paired', 'displayName': ''})
        self.assertEqual(self.kiosk.state['passengerName'], '小明')


if __name__ == '__main__': unittest.main()
