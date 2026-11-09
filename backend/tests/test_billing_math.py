import unittest
from decimal import Decimal

from app.billing_math import calculate_bill, money


class BillingMathTests(unittest.TestCase):
    def test_discount_is_applied_before_tax_and_service_charge(self):
        totals = calculate_bill(
            Decimal("1000.00"), Decimal("10"),
            True, Decimal("13"), True, Decimal("10"),
        )
        self.assertEqual(totals["subtotal"], Decimal("1000.00"))
        self.assertEqual(totals["discount_amount"], Decimal("100.00"))
        self.assertEqual(totals["taxable_subtotal"], Decimal("900.00"))
        self.assertEqual(totals["tax_amount"], Decimal("117.00"))
        self.assertEqual(totals["service_charge_amount"], Decimal("90.00"))
        self.assertEqual(totals["grand_total"], Decimal("1107.00"))

    def test_full_discount_produces_zero_total(self):
        totals = calculate_bill(
            Decimal("500.00"), Decimal("100"),
            True, Decimal("13"), True, Decimal("10"),
        )
        self.assertEqual(totals["grand_total"], Decimal("0.00"))

    def test_disabled_tax_and_service_charge(self):
        totals = calculate_bill(
            Decimal("125.50"), Decimal("0"),
            False, Decimal("13"), False, Decimal("10"),
        )
        self.assertEqual(totals["tax_amount"], Decimal("0.00"))
        self.assertEqual(totals["service_charge_amount"], Decimal("0.00"))
        self.assertEqual(totals["grand_total"], Decimal("125.50"))

    def test_currency_rounding_uses_half_up(self):
        self.assertEqual(money(Decimal("1.005")), Decimal("1.01"))


if __name__ == "__main__":
    unittest.main()
