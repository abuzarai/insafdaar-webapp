const requiredFields = {
  fullName: "Full name", email: "Email", phone: "Phone number", cnic: "CNIC",
  city: "City", address: "Address", location: "Location",
  emergencyContactName: "Emergency contact name", emergencyContactPhone: "Emergency contact phone",
};

export function profileProgress(profile: Partial<Record<keyof typeof requiredFields, string>>) {
  const missing = Object.entries(requiredFields).filter(([key]) => !profile[key as keyof typeof requiredFields]?.trim()).map(([, label]) => label);
  return { missing, percent: Math.round((Object.keys(requiredFields).length - missing.length) / Object.keys(requiredFields).length * 100) };
}
