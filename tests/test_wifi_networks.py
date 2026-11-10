import sys
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hardware'))
from wifi_networks import WifiNetworks, validate_networks, is_fallback


class WifiTests(unittest.TestCase):
    def test_validation_happens_before_any_write(self):
        wifi = WifiNetworks()
        for networks in ([], [{'ssid': '家' * 11, 'password': '12345678'}], [{'ssid': 'Home', 'password': 'short'}],
                         [{'ssid': 'Home'}, {'ssid': 'Home'}], [{'ssid': 'Home\nunsafe'}]):
            with patch.object(wifi, 'run') as run, self.assertRaises(ValueError): wifi.save(networks)
            run.assert_not_called()
        validate_networks([{'ssid': '家中網路', 'password': '12345678'}, {'ssid': 'Open', 'password': ''}])

    def test_saved_profiles_do_not_activate_or_overwrite_other_ssids(self):
        wifi = WifiNetworks()
        with patch.object(wifi, 'profiles', return_value=[]), patch.object(wifi, 'run', return_value='') as run:
            wifi.save([{'ssid': 'Home', 'password': 'secret123'}, {'ssid': 'Other', 'password': ''}, {'ssid': 'T2-308教室', 'password': 'secret456'}])
        calls = [c.args for c in run.call_args_list]
        self.assertEqual(sum(c[:2] == ('connection', 'add') for c in calls), 3)
        self.assertFalse(any('up' in c or 'down' in c for c in calls))
        self.assertEqual(len({c[c.index('connection.uuid') + 1] for c in calls if 'connection.uuid' in c}), 3)
        self.assertTrue(any('-999' in c for c in calls))

    def test_class_last_even_if_already_connected_and_old_priority_999(self):
        wifi = WifiNetworks()
        profiles = [{'ssid': 'T2-308教室', 'uuid': 'class', 'priority': 999}, {'ssid': 'Home', 'uuid': 'home', 'priority': 20}, {'ssid': 'Other', 'uuid': 'other', 'priority': 10}]
        attempted = []
        def run(*args, **kwargs):
            if 'up' in args:
                attempted.append(args[args.index('uuid') + 1]); raise RuntimeError('unreachable')
            return ''
        with patch.object(wifi, 'profiles', return_value=profiles), patch.object(wifi, 'current', return_value={'uuid': 'class', 'ssid': 'T2-308教室'}), patch.object(wifi, 'run', side_effect=run):
            self.assertEqual(wifi.connect_saved()['uuid'], 'class')
        self.assertEqual(attempted, ['home', 'other'])
        self.assertTrue(is_fallback('t2308')); self.assertTrue(is_fallback('T2-308教室'))

    def test_first_success_stops_attempts_and_failed_candidates_continue(self):
        wifi = WifiNetworks()
        profiles = [{'ssid': 'Home', 'uuid': 'home', 'priority': 20}, {'ssid': 'Other', 'uuid': 'other', 'priority': 10}, {'ssid': 't2308', 'uuid': 'class', 'priority': 999}]
        active = None; attempted = []
        def run(*args, **kwargs):
            nonlocal active
            if 'up' in args:
                name = args[args.index('uuid') + 1]; attempted.append(name)
                if name == 'home': raise RuntimeError('unreachable')
                active = {'ssid': 'Other', 'uuid': name}
            return ''
        with patch.object(wifi, 'profiles', return_value=profiles), patch.object(wifi, 'current', side_effect=lambda: active), patch.object(wifi, 'run', side_effect=run):
            self.assertEqual(wifi.connect_saved()['uuid'], 'other')
        self.assertEqual(attempted, ['home', 'other'])

    def test_timeout_error_does_not_expose_password_in_command(self):
        wifi = WifiNetworks()
        with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired(['nmcli', 'password', 'TOPSECRET'], 12)):
            with self.assertRaises(RuntimeError) as error: wifi.run('password', 'TOPSECRET')
        self.assertNotIn('TOPSECRET', str(error.exception))

    def test_partial_save_failure_reports_index_and_removes_incomplete_new_profile(self):
        wifi = WifiNetworks()
        def run(*args, **kwargs):
            if 'modify' in args: raise RuntimeError('failed')
            return ''
        with patch.object(wifi, 'profiles', return_value=[]), patch.object(wifi, 'run', side_effect=run) as command:
            with self.assertRaisesRegex(RuntimeError, '第 1 組'): wifi.save([{'ssid': 'Home', 'password': 'secret123'}])
        self.assertTrue(any(c.args[:2] == ('connection', 'delete') for c in command.call_args_list))

if __name__ == '__main__': unittest.main()
