import importlib.util
import json
from pathlib import Path
from threading import Thread
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'hardware/device_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_adc_uses_a0_and_correct_byte_order_and_scale(self):
        bus = Mock()
        bus.read_i2c_block_data.side_effect = [[0x43, 0x83], [0xC3, 0x83], [0x67, 0x20]]
        self.assertAlmostEqual(bridge.ADS1115(bus).read_voltage(), 3.3)
        bus.write_i2c_block_data.assert_called_once_with(0x48, 1, [0xC3, 0x83])
        self.assertEqual(bus.read_i2c_block_data.call_args.args, (0x48, 0, 2))

    def test_adc_negative_and_stuck_conversion(self):
        bus = Mock()
        bus.read_i2c_block_data.side_effect = [[0xC3, 0x83], [0xFF, 0xFF]]
        self.assertAlmostEqual(bridge.ADS1115(bus).read_voltage(), -0.000125)
        with patch.object(bridge.time, 'monotonic', side_effect=[0, 1]):
            with self.assertRaises(OSError):
                bridge.ADS1115(bus).read_voltage()

    def test_all_eight_directions_and_endpoints(self):
        for direction in range(8):
            self.assertEqual(bridge.DirectionFilter().update((direction + 0.5) / 8 * 3.3), direction)
        self.assertEqual(bridge.DirectionFilter().update(-0.001), 0)
        self.assertEqual(bridge.DirectionFilter().update(3.31), 7)
        self.assertEqual(bridge.DirectionFilter(reverse=True).update(0), 7)
        self.assertEqual(bridge.DirectionFilter(0.2, 3.1).update(3.1), 7)

    def test_noisy_boundary_stays_stable_but_real_turn_changes_heading(self):
        knob = bridge.DirectionFilter()
        self.assertEqual(knob.update(0.48 * 3.3), 3)
        for position in [0.499, 0.501] * 20:
            self.assertEqual(knob.update(position * 3.3), 3)
        for _ in range(20):
            direction = knob.update(0.6 * 3.3)
        self.assertEqual(direction, 4)

    def test_held_magnet_and_release_do_not_add_commands(self):
        state = bridge.DeviceState()
        state.reed('takeoff', True, initial=True)
        state.reed('takeoff', True)
        self.assertEqual(state.snapshot()['takeoffCount'], 0)
        state.reed('takeoff', False)
        state.reed('takeoff', True)
        state.reed('takeoff', True)
        state.reed('land', True)
        state.reed('land', False)
        snapshot = state.snapshot()
        self.assertEqual(snapshot['takeoffCount'], 1)
        self.assertEqual(snapshot['landCount'], 1)
        self.assertFalse(snapshot['landClosed'])

    def test_adc_failure_cannot_reuse_stale_heading(self):
        state = bridge.DeviceState()
        state.adc(3, 1.5)
        state.adc(None, None, 'I2C unavailable')
        self.assertIsNone(state.snapshot()['direction'])
        self.assertIsNone(state.snapshot()['voltage'])

    def test_http_snapshot_and_cors_origin_boundary(self):
        state = bridge.DeviceState()
        state.reed('land', True)
        server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), bridge.make_handler(state, bridge.SITE_ORIGIN))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/state'
        try:
            with urlopen(Request(url, headers={'Origin': bridge.SITE_ORIGIN}), timeout=2) as response:
                self.assertEqual(json.load(response)['landCount'], 1)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], bridge.SITE_ORIGIN)
            headers = {'Origin': bridge.SITE_ORIGIN, 'Access-Control-Request-Private-Network': 'true'}
            with urlopen(Request(url, method='OPTIONS', headers=headers), timeout=2) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Private-Network'], 'true')
            with self.assertRaises(HTTPError) as rejected:
                urlopen(Request(url, headers={'Origin': 'https://unrelated.example'}), timeout=2)
            self.assertEqual(rejected.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
