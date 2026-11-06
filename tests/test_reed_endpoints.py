import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('bridge',Path(__file__).resolve().parents[1]/'hardware/device_bridge.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class EndpointTests(unittest.TestCase):
 def make(self,t=False,l=False):
  self.state=b.DeviceState();self.now=0
  self.filter=b.ReedFilter(self.state,{'takeoff':t,'land':l},0)
 def move(self,t,l,seconds=.2):
  sample={'takeoff':t,'land':l};self.now+=.02
  self.filter.update(sample,self.now);self.now+=seconds
  self.filter.update(sample,self.now)
 def counts(self):
  s=self.state.snapshot();return s['takeoffCount'],s['landCount']
 def test_held_magnet_and_same_end_reclosures_do_not_repeat(self):
  self.make();self.move(True,False)
  self.move(True,False,86400);self.move(False,False);self.move(True,False)
  self.assertEqual(self.counts(),(1,0))
 def test_only_stable_opposite_endpoint_rearms(self):
  self.make();self.move(True,False);self.move(False,False)
  self.move(False,True);self.move(False,False);self.move(False,True)
  self.assertEqual(self.counts(),(1,1))
  self.move(False,False);self.move(True,False)
  self.assertEqual(self.counts(),(2,1))
 def test_short_noise_does_not_change_reported_endpoint(self):
  self.make();self.move(True,False,.03);self.move(False,False)
  self.assertEqual(self.counts(),(0,0))
  self.assertFalse(self.state.snapshot()['takeoffClosed'])
 def test_startup_at_either_end_is_baseline_not_action(self):
  for t,l in [(True,False),(False,True),(True,True)]:
   self.make(t,l);self.move(t,l,30);self.assertEqual(self.counts(),(0,0))
 def test_overlapping_sensors_never_trigger_on_release(self):
  self.make();self.move(True,True);self.move(False,True)
  self.assertEqual(self.counts(),(0,0))
  self.move(False,False);self.move(False,True)
  self.assertEqual(self.counts(),(0,1))
if __name__=='__main__':unittest.main()
