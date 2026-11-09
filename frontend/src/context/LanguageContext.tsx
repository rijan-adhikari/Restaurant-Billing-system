import React, { createContext, useContext, useMemo, useState } from "react";

export type Language = "en" | "ne";

const translations: Record<string, string> = {
  "Dashboard": "ड्यासबोर्ड", "Tables / POS": "टेबल / बिक्री", "Kitchen": "भान्सा", "Bar": "बार",
  "Billing": "बिलिङ", "Credit": "उधारो", "Restaurant Operations": "रेस्टुरेन्ट सञ्चालन",
  "Master Panel": "मुख्य व्यवस्थापन", "Control Centre": "नियन्त्रण केन्द्र", "Log out": "लगआउट",
  "Royal Skye · Overview": "रोयल स्काई · मुख्य विवरण", "Good to see you,": "स्वागत छ,",
  "Sales and operations snapshot": "बिक्री तथा सञ्चालनको सारांश", "Report date": "रिपोर्ट मिति",
  "Daily sales": "आजको बिक्री", "Monthly sales": "यो महिनाको बिक्री", "Yearly sales": "यो वर्षको बिक्री",
  "Daily expenses": "आजको खर्च", "Monthly expenses": "यो महिनाको खर्च", "Yearly expenses": "यो वर्षको खर्च",
  "Estimated daily profit / loss": "आजको अनुमानित नाफा / घाटा", "Estimated monthly profit / loss": "यो महिनाको अनुमानित नाफा / घाटा",
  "Estimated yearly profit / loss": "यो वर्षको अनुमानित नाफा / घाटा", "Daily estimated COGS": "आजको अनुमानित सामान लागत",
  "Monthly estimated COGS": "यो महिनाको अनुमानित सामान लागत", "Yearly estimated COGS": "यो वर्षको अनुमानित सामान लागत",
  "Outstanding credit": "बाँकी उधारो", "Pending KOTs": "बाँकी किचन अर्डर", "Occupied tables": "व्यस्त टेबल",
  "Clear sales data": "बिक्री विवरण हटाउनुहोस्", "Clear all sales": "सबै बिक्री विवरण हटाउनुहोस्",
  "Type CLEAR SALES": "CLEAR SALES टाइप गर्नुहोस्",
  "Manage food, prices, routing, and availability.": "खाना, मूल्य, अर्डर जाने ठाउँ र उपलब्धता व्यवस्थापन गर्नुहोस्।",
  "Staff accounts": "कर्मचारी खाता", "Food menu": "खानाको मेनु", "Expenses": "खर्च",
  "Categories": "खानाका वर्गहरू", "Manage categories, staff, customers, and expenses.": "वर्ग, कर्मचारी, ग्राहक र खर्च व्यवस्थापन गर्नुहोस्।",
  "Keep your categories ready. Dishes can be added later when needed.": "खानाका वर्गहरू तयार राख्नुहोस्। आवश्यक परे पछि परिकार थप्न सकिन्छ।",
  "Remove all dishes": "सबै परिकार हटाउनुहोस्",
  "Remove every dish from the POS menu? Categories and past order history will be kept.": "POS मेनुका सबै परिकार हटाउने? वर्ग र पुराना अर्डर विवरण सुरक्षित रहनेछन्।",
  "All dishes have been removed. Categories are still available.": "सबै परिकार हटाइयो। खानाका वर्गहरू सुरक्षित छन्।",
  "No categories yet. Add your first category above.": "अहिलेसम्म कुनै वर्ग छैन। माथिबाट पहिलो वर्ग थप्नुहोस्।",
  "Add food item": "खाना थप्नुहोस्", "Edit food item": "खाना सम्पादन गर्नुहोस्", "Add expense": "खर्च थप्नुहोस्",
  "Customer history": "ग्राहकको विवरण", "Search history": "विवरण खोज्नुहोस्", "Name": "नाम",
  "Username": "प्रयोगकर्ता नाम", "Full name": "पूरा नाम", "Role": "भूमिका", "Status": "अवस्था",
  "Actions": "कार्य", "Edit": "सम्पादन", "Delete": "हटाउनुहोस्", "Save": "सेभ गर्नुहोस्",
  "Category": "वर्ग", "Food name": "खानाको नाम", "Description": "विवरण", "Price (NPR)": "मूल्य (रु.)",
  "Send order to": "अर्डर पठाउने ठाउँ", "Available for POS orders": "POS मा उपलब्ध",
  "Date": "मिति", "Amount": "रकम", "Phone": "फोन नम्बर", "Customer": "ग्राहक",
  "From date": "सुरु मिति", "To date": "अन्तिम मिति", "All customers": "सबै ग्राहक",
  "English": "अंग्रेजी", "Nepali": "नेपाली", "Language": "भाषा",
  "Temporary password (8+ characters)": "अस्थायी पासवर्ड (कम्तीमा ८ अक्षर)",
  "Temporary login": "अस्थायी लगइन", "Change password": "पासवर्ड परिवर्तन", "New password": "नयाँ पासवर्ड",
  "Disable": "बन्द गर्नुहोस्", "Active · disable": "सक्रिय · बन्द गर्नुहोस्", "Inactive · enable": "निष्क्रिय · खोल्नुहोस्",
  "Hide food menu": "मेनु लुकाउनुहोस्", "Show food menu": "मेनु देखाउनुहोस्",
  "Food menu is hidden. Click “Show food menu” to view and edit items.": "मेनु लुकाइएको छ। खाना हेर्न र सम्पादन गर्न “मेनु देखाउनुहोस्” थिच्नुहोस्।",
  "Food": "खाना", "Available": "उपलब्ध", "Unavailable": "अनुपलब्ध",
  "New category name": "नयाँ वर्गको नाम", "Add category": "वर्ग थप्नुहोस्", "Select category": "वर्ग छान्नुहोस्",
  "Save changes": "परिवर्तन सेभ गर्नुहोस्", "Add food": "खाना थप्नुहोस्", "Cancel": "रद्द गर्नुहोस्",
  "Customer records": "ग्राहक विवरण", "See what each customer ordered and spent during a selected date range.": "छानिएको मितिमा ग्राहकले के अर्डर गरे र कति खर्च गरे हेर्नुहोस्।",
  "Loading...": "लोड हुँदैछ...", "No customer records.": "ग्राहक विवरण छैन।", "No expenses recorded.": "खर्च विवरण छैन।",
  "No phone": "फोन छैन", "Total spent:": "जम्मा खर्च:", "Paid:": "तिरेको:", "Outstanding:": "बाँकी:",
  "Choose filters and click Search history to view customer visits.": "ग्राहकको भ्रमण हेर्न मिति छानेर खोज्नुहोस्।",
  "Add staff account": "कर्मचारी खाता थप्नुहोस्",
  "This password is shown once and is not stored for display.": "यो पासवर्ड एक पटक मात्र देखाइन्छ।",
  "Price": "मूल्य", "Table": "टेबल", "Paid": "तिरेको", "Outstanding": "बाँकी",
  "Expense category": "खर्चको वर्ग", "General": "सामान्य", "Select customer": "ग्राहक छान्नुहोस्",
  "Remove": "हटाउनुहोस्",
  "admin": "प्रशासक", "manager": "व्यवस्थापक", "cashier": "क्यासियर", "waiter": "वेटर",
  "kitchen": "भान्सा", "bar": "बार", "Username:": "प्रयोगकर्ता नाम:", "Password:": "पासवर्ड:",
  "Could not load customer history.": "ग्राहक विवरण लोड गर्न सकिएन।",
  "This removes bills, payments, credit balances, and completed/open order state. Menu, customers, staff, and expenses are preserved.": "यसले बिल, भुक्तानी, उधारो र अर्डर विवरण हटाउँछ। मेनु, ग्राहक, कर्मचारी र खर्च सुरक्षित रहन्छन्।",
  "Restaurant Operations": "रेस्टुरेन्ट सञ्चालन", "Inventory, procurement, recipes, finance and staff operations.": "मौज्दात, खरिद, परिकारका विधि, वित्त र कर्मचारी व्यवस्थापन।",
  "Refresh data": "विवरण ताजा गर्नुहोस्", "Working...": "काम हुँदैछ...", "Stock items": "स्टक सामान", "Low stock": "कम मौज्दात", "Suppliers": "आपूर्तिकर्ता", "Recipes": "रेसिपीहरू",
  "inventory": "मौज्दात", "suppliers": "आपूर्तिकर्ता", "purchases": "खरिद", "recipes": "रेसिपी", "expenses": "खर्च", "reports": "प्रतिवेदन", "staff": "कर्मचारी", "reservations": "टेबल बुकिङ",
  "Add stock item": "स्टक सामान थप्नुहोस्", "Opening stock, base unit and reorder threshold.": "सुरुको मौज्दात, एकाइ र फेरि अर्डर गर्नुपर्ने न्यूनतम सीमा।",
  "Item name": "सामानको नाम", "SKU": "सामान कोड (SKU)", "Unit": "एकाइ", "Opening quantity": "सुरुको परिमाण", "Reorder level": "फेरि मगाउनुपर्ने सीमा",
  "Average cost (NPR)": "औसत लागत (रु.)", "Preferred supplier": "प्राथमिक आपूर्तिकर्ता", "No supplier": "आपूर्तिकर्ता छैन", "Expiry date": "म्याद सकिने मिति",
  "Add item": "सामान थप्नुहोस्", "Conversions supported in API: kg/g, litre/ml and dozen/pcs.": "एकाइ रूपान्तरण उपलब्ध: केजी/ग्राम, लिटर/मिली र दर्जन/वटा।",
  "Stock register": "स्टक विवरण", "Quantity, valuation and low-stock alerts.": "परिमाण, मूल्याङ्कन र कम मौज्दातको सूचना।", "item(s) at or below reorder level.": "वटा सामानको मौज्दात तोकिएको सीमामा वा त्यसभन्दा कम छ।",
  "Item": "सामान", "On hand": "हाल मौज्दात", "Reorder": "फेरि मगाउने सीमा", "Average cost": "औसत लागत", "Value": "कुल मूल्य", "Expiry": "म्याद", "Status": "अवस्था",
  "No SKU": "SKU छैन", "Low": "कम", "OK": "ठीक", "Select item": "सामान छान्नुहोस्", "Wastage": "खेर गएको", "Consumption": "खपत", "Return": "फिर्ता", "Stock count adjustment": "स्टक गणना मिलान",
  "Counted stock quantity": "गनेको स्टक परिमाण", "Quantity": "परिमाण", "Record movement": "स्टक परिवर्तन दर्ता गर्नुहोस्",
  "Stock movement recorded.": "स्टक परिवर्तन दर्ता भयो।", "Inventory item created.": "स्टक सामान थपियो।",
  "Add supplier": "आपूर्तिकर्ता थप्नुहोस्", "Supplier contact and tax information.": "आपूर्तिकर्ताको सम्पर्क र करसम्बन्धी विवरण।", "Name": "नाम", "Phone": "फोन", "Email": "इमेल", "Address": "ठेगाना", "PAN / tax number": "प्यान / कर नम्बर",
  "Save supplier": "आपूर्तिकर्ता सेभ गर्नुहोस्", "Supplier saved.": "आपूर्तिकर्ता सेभ भयो।", "Supplier directory": "आपूर्तिकर्ता सूची", "Active vendors.": "सक्रिय आपूर्तिकर्ताहरू।", "No phone": "फोन छैन", "No email": "इमेल छैन", "No PAN": "प्यान छैन",
  "Receive purchase": "खरिद सामान भित्र्याउनुहोस्", "Record a supplier invoice with multiple stock lines.": "धेरै सामानसहित आपूर्तिकर्ताको बिल दर्ता गर्नुहोस्।", "Choose supplier": "आपूर्तिकर्ता छान्नुहोस्", "Stock item": "स्टक सामान", "Choose item": "सामान छान्नुहोस्", "Unit cost (NPR)": "प्रति एकाइ लागत (रु.)", "Remove line": "यो लाइन हटाउनुहोस्", "+ Add purchase line": "+ खरिदको सामान थप्नुहोस्", "Invoice notes": "बिलसम्बन्धी टिप्पणी", "Receive purchase": "खरिद दर्ता गर्नुहोस्", "Purchase received and stock updated.": "खरिद दर्ता भयो र स्टक अद्यावधिक भयो।", "Purchase history": "खरिद इतिहास", "Latest supplier receipts.": "हालैका आपूर्तिकर्ता बिलहरू।",
  "Recipe builder": "रेसिपी बनाउनुहोस्", "Build a complete ingredient list for each menu item.": "हरेक मेनु परिकारका सामग्रीहरूको सूची बनाउनुहोस्।", "Menu item": "मेनुको परिकार", "Choose menu item": "मेनुको परिकार छान्नुहोस्", "Ingredient": "सामग्री", "Choose ingredient": "सामग्री छान्नुहोस्", "Add ingredient": "सामग्री थप्नुहोस्", "+ Add ingredient": "+ सामग्री थप्नुहोस्", "Yield quantity": "बन्ने परिमाण", "Instructions": "बनाउने विधि", "Save recipe": "रेसिपी सेभ गर्नुहोस्", "Recipe saved.": "रेसिपी सेभ भयो।", "Recipe costs": "रेसिपीको लागत", "Calculated from current average ingredient cost.": "सामग्रीको हालको औसत लागतका आधारमा गणना गरिएको।", "Yield:": "बन्ने परिमाण:", "Configured recipe ingredients are deducted automatically when the bill is finalized. Stock is checked before the bill is committed.": "बिल अन्तिम गर्दा रेसिपीमा तोकिएका सामग्री स्टकबाट स्वतः घट्छन्। बिल पुष्टि गर्नुअघि स्टक जाँच गरिन्छ।",
  "Record expense": "खर्च दर्ता गर्नुहोस्", "Department, payment status and receipt reference.": "विभाग, भुक्तानी अवस्था र रसिद नम्बर।", "Description": "विवरण", "Amount (NPR)": "रकम (रु.)", "Date": "मिति", "Department": "विभाग", "Payment status": "भुक्तानी अवस्था", "Paid": "तिरेको", "Unpaid": "तिर्न बाँकी", "Partial": "आंशिक", "Supplier (optional)": "आपूर्तिकर्ता (ऐच्छिक)", "Receipt reference": "रसिद नम्बर", "Notes": "टिप्पणी", "Save expense": "खर्च सेभ गर्नुहोस्", "Expense recorded.": "खर्च दर्ता भयो।", "Expense register": "खर्च विवरण", "Purchases and COGS are tracked separately.": "खरिद र सामानको लागत छुट्टाछुट्टै हिसाब गरिन्छ।",
  "Profit & loss": "नाफा तथा घाटा", "Net sales, estimated recipe-based COGS and operating expenses.": "खुद बिक्री, रेसिपीका आधारमा अनुमानित सामान लागत र सञ्चालन खर्च।", "From": "देखि", "To": "सम्म", "Generate report": "प्रतिवेदन तयार गर्नुहोस्", "Report generated.": "प्रतिवेदन तयार भयो।", "Export stock CSV": "स्टक CSV डाउनलोड गर्नुहोस्", "Net sales": "खुद बिक्री", "Estimated COGS": "अनुमानित सामान लागत", "Estimated gross profit": "अनुमानित कुल नाफा", "Estimated operating profit": "अनुमानित सञ्चालन नाफा",
  "Attendance": "हाजिरी", "Clock staff in and out.": "कर्मचारीको हाजिर र बिदा समय दर्ता गर्नुहोस्।", "Select staff": "कर्मचारी छान्नुहोस्", "Clock in": "हाजिर गर्नुहोस्", "Clock out": "बिदा हुनुहोस्", "Clocked in.": "हाजिर दर्ता भयो।", "Clocked out.": "बिदा समय दर्ता भयो।",
  "Payroll register": "तलब विवरण", "Record salaries, deductions and payment status.": "तलब, कट्टी र भुक्तानी अवस्था दर्ता गर्नुहोस्।", "Staff member": "कर्मचारी", "Gross salary (NPR)": "कुल तलब (रु.)", "Period start": "अवधि सुरु", "Period end": "अवधि समाप्त", "Deductions (NPR)": "कट्टी (रु.)", "Create payroll record": "तलब विवरण बनाउनुहोस्", "Payroll entry created.": "तलब विवरण बनाइयो।", "Paid": "भुक्तानी भयो", "Unpaid": "भुक्तानी बाँकी", "Mark paid": "भुक्तानी भएको चिन्ह लगाउनुहोस्", "Payroll marked as paid.": "तलब भुक्तानी भएको चिन्ह लगाइयो।",
  "Book a table": "टेबल बुक गर्नुहोस्", "Create a future reservation.": "आगामी मितिका लागि टेबल बुक गर्नुहोस्।", "Customer name": "ग्राहकको नाम", "Party size": "व्यक्तिको संख्या", "Date and time": "मिति र समय", "Assign table (optional)": "टेबल तोक्नुहोस् (ऐच्छिक)", "No table assigned": "टेबल तोकिएको छैन", "Create reservation": "बुकिङ गर्नुहोस्", "Reservation created.": "बुकिङ भयो।", "Reservations": "बुकिङहरू", "Upcoming and recent bookings.": "आगामी र हालैका बुकिङहरू।", "guests": "जना", "Reservation updated.": "बुकिङ अद्यावधिक भयो।", "Booked": "बुक भएको", "Seated": "टेबलमा बसेको", "Completed": "सम्पन्न", "Cancelled": "रद्द",
  "Could not load operations data.": "सञ्चालनसम्बन्धी विवरण लोड गर्न सकिएन।", "Restaurant operations request failed": "रेस्टुरेन्ट सञ्चालनको अनुरोध असफल भयो।"

};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (value: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem("app-language") === "ne" ? "ne" : "en");
  const setLanguage = (next: Language) => {
    localStorage.setItem("app-language", next);
    setLanguageState(next);
  };
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (value: string) => language === "ne" ? (translations[value] || value) : value
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
