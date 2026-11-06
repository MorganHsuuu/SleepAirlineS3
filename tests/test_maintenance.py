import importlib.util
import json
from pathlib import Path
from threading import Thread,Lock
import unittest
from unittest.mock import Mock,patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
spec=importlib.util.spec_from_file_location('kiosk',Path(__file__).resolve().parents[1]/'hardware/device_kiosk.py')
k=importlib.util.module_from_spec(spec);spec.loader.exec_module(k)
class MaintenanceTests(unittest.TestCase):
 def test_only_local_browser_and_known_origins_can_request_a_terminal(self):
  kiosk=Mock();kiosk.open_terminal.return_value={'status':'opened'}
  handler=k.handler_for(kiosk)
  server=k.ThreadingHTTPServer(('127.0.0.1',0),handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
  url=f'http://127.0.0.1:{server.server_port}/api/maintenance/terminal'
  try:
   for origin in (k.WINDOW_ORIGIN,'http://127.0.0.1:8766'):
    req=Request(url,method='POST',headers={'Origin':origin,'X-Sleep-Airline-Maintenance':'1'})
    with urlopen(req) as response:self.assertEqual(json.load(response)['status'],'opened')
   for headers in ({},{'Origin':k.WINDOW_ORIGIN},{'Origin':'https://unrelated.example','X-Sleep-Airline-Maintenance':'1'}):
    with self.assertRaises(HTTPError) as error:urlopen(Request(url,method='POST',headers=headers))
    self.assertEqual(error.exception.code,403)
   with urlopen(Request(url,method='OPTIONS',headers={'Origin':k.WINDOW_ORIGIN,'Access-Control-Request-Private-Network':'true'})) as response:
    self.assertIn('X-Sleep-Airline-Maintenance',response.headers['Access-Control-Allow-Headers'])
    self.assertEqual(response.headers['Access-Control-Allow-Private-Network'],'true')
   fake=Mock();fake.client_address=('192.168.1.5',1234);fake.headers={'Origin':k.WINDOW_ORIGIN}
   self.assertFalse(handler.maintenance_allowed(fake))
   self.assertEqual(kiosk.open_terminal.call_count,2)
  finally:server.shutdown();server.server_close();thread.join()
 def test_terminal_launch_has_no_shell_and_is_rate_limited(self):
  kiosk=k.Kiosk.__new__(k.Kiosk);kiosk.lock=Lock();kiosk.last_terminal_open=None
  process=Mock();process.wait.side_effect=k.subprocess.TimeoutExpired('terminal',.3)
  with patch.object(k.sys,'platform','linux'),patch.object(k.shutil,'which',return_value='/usr/bin/lxterminal'),patch.object(k.subprocess,'Popen',return_value=process) as launch:
   self.assertEqual(kiosk.open_terminal(),{'status':'opened'})
   self.assertEqual(launch.call_args.args[0],['/usr/bin/lxterminal'])
   self.assertFalse(launch.call_args.kwargs.get('shell',False))
   self.assertIn('XDG_RUNTIME_DIR',launch.call_args.kwargs['env'])
   with self.assertRaises(RuntimeError):kiosk.open_terminal()
   self.assertEqual(launch.call_count,1)
 def test_missing_terminal_is_reported(self):
  kiosk=k.Kiosk.__new__(k.Kiosk);kiosk.lock=Lock();kiosk.last_terminal_open=None
  with patch.object(k.sys,'platform','linux'),patch.object(k.shutil,'which',return_value=None):
   with self.assertRaisesRegex(RuntimeError,'lxterminal'):kiosk.open_terminal()
 def test_offline_page_includes_hidden_maintenance_entry(self):
  page=k.html_page('離線','<p id="reason"></p>')
  self.assertIn('maintenance-hotspot',page)
  self.assertIn('api/maintenance/terminal',page)
if __name__=='__main__':unittest.main()
