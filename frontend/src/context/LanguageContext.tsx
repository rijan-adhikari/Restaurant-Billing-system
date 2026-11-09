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
  "Could not load customer history.": "ग्राहक विवरण लोड गर्न सकिएन।",
  "This removes bills, payments, credit balances, and completed/open order state. Menu, customers, staff, and expenses are preserved.": "यसले बिल, भुक्तानी, उधारो र अर्डर विवरण हटाउँछ। मेनु, ग्राहक, कर्मचारी र खर्च सुरक्षित रहन्छन्।"
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
