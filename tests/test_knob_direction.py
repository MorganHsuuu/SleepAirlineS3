import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1]/'hardware/device_bridge.py')
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
class KnobDirectionTests(unittest.TestCase):
    def test_device_default_reverses_both_heading_and_mood_position(self):
        low,high=bridge.DirectionFilter(),bridge.DirectionFilter()
        self.assertEqual(low.update(0),7)
        self.assertEqual(low.filtered,1)
        self.assertEqual(high.update(3.3),0)
        self.assertEqual(high.filtered,0)
    def test_original_orientation_remains_available(self):
        f=bridge.DirectionFilter(reverse=False)
        self.assertEqual(f.update(0),0)
        for _ in range(50): f.update(3.3)
        self.assertEqual(f.direction,7)
    def test_reversed_rotation_is_monotonic(self):
        f=bridge.DirectionFilter()
        positions=[]
        for i in range(101):
            f.update(3.3*(1-i/100))
            positions.append(f.filtered)
        self.assertEqual(positions,sorted(positions))
if __name__=='__main__': unittest.main()
