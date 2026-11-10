import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch, Mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('wifi_kiosk', Path(__file__).resolve().parents[1] / 'hardware/device_kiosk.py')
k = importlib.util.module_from_spec(spec); spec.loader.exec_module(k)

class WifiHttpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        state = patch.object(k, 'STATE_FILE', Path(temporary.name) / 'device.json'); state.start(); self.addCleanup(state.stop)
        self.kiosk = k.Kiosk(argparse.Namespace(dry_run=True, interface='wlan0', reconfigure_wifi=False))
        self.kiosk.ensure_setup_code(); self.kiosk.status = 'ready'; self.kiosk.setup_mode = 'lan'
        self.server = k.ThreadingHTTPServer(('127.0.0.1', 0), k.handler_for(self.kiosk))
        self.thread = Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.addCleanup(self.stop)
    def stop(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
    def post(self, data, path='/api/provision', origin=None, **headers):
        headers = {'Content-Type': 'application/json', **headers}
        if origin: headers['Origin'] = origin
        return urlopen(Request(self.url + path, json.dumps(data).encode(), headers=headers))
    def test_multiple_networks_reach_worker_without_leaking_passwords(self):
        payload = {'setupCode': self.kiosk.state['setupCode'], 'grant': 'grant', 'connectNow': False,
                   'networks': [{'ssid': 'Home', 'password': 'TOPSECRET'}, {'ssid': 'Backup', 'password': ''}]}
        with patch.object(k, 'Thread') as worker:
            with self.post(payload, origin=self.url) as response: self.assertEqual(response.status, 202)
        self.assertEqual(worker.call_args.kwargs['args'][0], payload['networks'])
        self.assertFalse(worker.call_args.kwargs['args'][2])
        with urlopen(self.url + '/api/status') as response:
            status = response.read().decode()
        self.assertNotIn('TOPSECRET', status); self.assertNotIn(payload['setupCode'], status)
        self.assertTrue(json.loads(status)['busy'])
    def test_cross_origin_invalid_payload_and_expired_code_rejected_before_write(self):
        with patch.object(k, 'Thread') as thread:
            for payload, origin, expected in [([], None, 400), ({'networks': []}, None, 400),
                    ({'networks': [{'ssid': 'Home'}], 'setupCode': 'bad', 'grant': 'x'}, None, 409),
                    ({}, 'https://unrelated.example', 403)]:
                with self.assertRaises(HTTPError) as error: self.post(payload, origin=origin)
                self.assertEqual(error.exception.code, expected)
        thread.assert_not_called()
    def test_only_local_device_screen_can_switch_mode(self):
        with self.assertRaises(HTTPError) as error:
            self.post({'mode': 'lan'}, '/api/setup-mode', 'https://unrelated.example')
        self.assertEqual(error.exception.code, 403)
        with patch.object(k, 'Thread'):
            with self.post({'mode': 'hotspot'}, '/api/setup-mode', 'http://127.0.0.1:8766', **{'X-Sleep-Airline-Setup':'1'}) as response:
                self.assertEqual(response.status, 202)
    def test_phone_form_contains_multiple_network_ui_and_does_not_embed_secrets(self):
        with urlopen(self.url + '/setup') as response: page = response.read().decode()
        self.assertIn('新增另一組 Wi-Fi', page); self.assertIn('已儲存', page)
        self.assertNotIn(self.kiosk.state['setupCode'], page)
        self.assertIn('setInterval(checkStatus', page)

if __name__ == '__main__': unittest.main()
