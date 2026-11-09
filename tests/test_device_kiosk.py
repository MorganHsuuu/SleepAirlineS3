import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError


spec = importlib.util.spec_from_file_location("device_kiosk", Path(__file__).resolve().parents[1] / "hardware/device_kiosk.py")
kiosk_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kiosk_module)


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_state_file = kiosk_module.STATE_FILE
        kiosk_module.STATE_FILE = Path(self.directory.name) / "device.json"
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(setattr, kiosk_module, "STATE_FILE", self.original_state_file)
        self.kiosk = kiosk_module.Kiosk(argparse.Namespace(dry_run=True, interface="wlan0", reconfigure_wifi=False))

    def test_hotspot_retries_keep_current_qr_until_expiry(self):
        self.kiosk.start_hotspot()
        first = (self.kiosk.state["setupCode"], self.kiosk.state["hotspotPassword"], self.kiosk.state["setupRevision"])
        self.kiosk.start_hotspot()
        self.assertEqual(first, (self.kiosk.state["setupCode"], self.kiosk.state["hotspotPassword"], self.kiosk.state["setupRevision"]))
        self.kiosk.state["setupExpires"] = 0
        self.kiosk.start_hotspot()
        self.assertNotEqual(first[0], self.kiosk.state["setupCode"])
        self.assertEqual(first[2] + 1, self.kiosk.state["setupRevision"])

    def test_wifi_success_sets_boot_priority_and_retries_cloud_confirmation(self):
        self.kiosk.start_hotspot()
        self.kiosk.args.dry_run = False
        calls = []

        def nmcli(command, **_kwargs):
            calls.append(command)
            output = "test-connection-uuid\n" if "GENERAL.CON-UUID" in command else ""
            return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

        with patch.object(kiosk_module.subprocess, "run", side_effect=nmcli), \
             patch.object(kiosk_module, "cloud_post", side_effect=[URLError("DNS not ready"), {"passengerId": "PAX-TEST0001"}]) as cloud, \
             patch.object(kiosk_module.time, "sleep"):
            self.kiosk._provision_worker("Home Wi-Fi", "password123", "grant")

        self.assertEqual(self.kiosk.status, "paired")
        self.assertEqual(self.kiosk.state["passengerId"], "PAX-TEST0001")
        self.assertEqual(cloud.call_count, 2)
        self.assertIn(["nmcli", "connection", "modify", "test-connection-uuid", "connection.autoconnect", "yes", "connection.autoconnect-priority", "999"], calls)

    def test_wrong_wifi_password_restores_same_hotspot_code(self):
        self.kiosk.start_hotspot()
        original_code = self.kiosk.state["setupCode"]
        self.kiosk.args.dry_run = False

        def nmcli(command, **_kwargs):
            code = 1 if "connect" in command else 0
            return subprocess.CompletedProcess(command, code, stdout="", stderr="failed")

        with patch.object(kiosk_module.subprocess, "run", side_effect=nmcli), patch.object(kiosk_module.time, "sleep"):
            self.kiosk._provision_worker("Home Wi-Fi", "wrong-password", "grant")

        self.assertEqual(self.kiosk.state["setupCode"], original_code)
        self.assertEqual(self.kiosk.status, "ready")
        self.assertIn("Wi-Fi", self.kiosk.message)
        self.assertFalse(self.kiosk.busy)
        with patch.object(kiosk_module, "Thread"):
            self.assertTrue(self.kiosk.provision("Home Wi-Fi", "corrected-password", "grant", original_code))
            self.assertFalse(self.kiosk.provision("Home Wi-Fi", "duplicate", "grant", original_code))

    def test_wifi_timeout_restores_hotspot_and_allows_retry(self):
        self.kiosk.start_hotspot()
        original_code = self.kiosk.state["setupCode"]
        self.kiosk.args.dry_run = False

        def nmcli(command, **_kwargs):
            if "connect" in command:
                raise subprocess.TimeoutExpired(command, 75)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        with patch.object(kiosk_module.subprocess, "run", side_effect=nmcli), patch.object(kiosk_module.time, "sleep"):
            self.kiosk._provision_worker("Home Wi-Fi", "wrong-password", "grant")
        self.assertFalse(self.kiosk.busy)
        self.assertEqual(self.kiosk.status, "ready")
        self.assertEqual(self.kiosk.state["setupCode"], original_code)

    def test_empty_cloud_display_name_does_not_erase_saved_passenger_name(self):
        self.kiosk.state["passengerId"] = "PAX-TEST0001"
        self.kiosk.state["passengerName"] = "小明"
        self.kiosk.apply_cloud_identity({"status": "paired", "passengerId": "PAX-TEST0001", "displayName": ""})
        self.assertEqual(self.kiosk.state["passengerName"], "小明")
        self.kiosk.apply_cloud_identity({"status": "paired", "passengerId": "PAX-TEST0001", "displayName": "Morgan"})
        self.assertEqual(self.kiosk.state["passengerName"], "Morgan")


if __name__ == "__main__":
    unittest.main()

