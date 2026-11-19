from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException

CENT = Decimal('0.01')

def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)

def calculate_bill(subtotal: Decimal, discount_percent: Decimal, tax_enabled: bool,
                   tax_percent: Decimal, service_enabled: bool,
                   service_percent: Decimal, fixed_discount: Decimal = Decimal('0')) -> dict[str, Decimal]:
    if not discount_percent.is_finite() or not tax_percent.is_finite() or not service_percent.is_finite() or not fixed_discount.is_finite():
        raise HTTPException(status_code=400, detail='Bill amounts and percentages must be finite numbers')
    if not subtotal.is_finite() or subtotal < 0:
        raise HTTPException(status_code=400, detail='Subtotal must be a non-negative finite amount')
    if discount_percent < 0 or discount_percent > 100:
        raise HTTPException(status_code=400, detail='Discount percentage must be between 0 and 100')
    if tax_percent < 0 or service_percent < 0:
        raise HTTPException(status_code=400, detail='Tax and service charge percentages cannot be negative')
    subtotal = money(subtotal)
    if fixed_discount < 0:
        raise HTTPException(status_code=400, detail='Fixed discount cannot be negative')
    # Tax and service charge are calculated on the pre-discount subtotal.
    tax = money(subtotal * tax_percent / Decimal('100')) if tax_enabled else Decimal('0.00')
    service = money(subtotal * service_percent / Decimal('100')) if service_enabled else Decimal('0.00')
    gross_total = money(subtotal + tax + service)
    percentage_discount = money(gross_total * discount_percent / Decimal('100'))
    discount = money(percentage_discount + fixed_discount)
    if discount > gross_total:
        raise HTTPException(status_code=400, detail='Total discount cannot exceed the bill total')
    total = money(gross_total - discount)
    return {'subtotal': subtotal, 'discount_amount': discount, 'taxable_subtotal': subtotal,
            'tax_amount': tax, 'service_charge_amount': service, 'grand_total': total}
