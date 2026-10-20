"""calculator.py 的单元测试。

运行方式：
    python -m unittest test_calculator -v
"""

import unittest

from calculator import add, div, is_even, mul, sub


class TestCalculator(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(1, 2), 3)
        self.assertEqual(add(-1, 1), 0)

    def test_sub(self):
        self.assertEqual(sub(5, 3), 2)

    def test_mul(self):
        self.assertEqual(mul(4, 2.5), 10)

    def test_div(self):
        self.assertAlmostEqual(div(10, 4), 2.5)

    def test_div_by_zero(self):
        with self.assertRaises(ValueError):
            div(1, 0)

    def test_is_even(self):
        self.assertTrue(is_even(0))
        self.assertTrue(is_even(4))
        self.assertFalse(is_even(7))


if __name__ == "__main__":
    unittest.main()
