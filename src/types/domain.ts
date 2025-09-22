export type SerialOptions = { width?: number };

export type Company = {
  name: string;
  nameLower: string;
  createdAt: FirebaseFirestore.FieldValue;
};

export type Project = {
  name: string;
  nameLower: string;
  companyId: string;
  companyName: string;
  isActive: boolean;
  createdAt: FirebaseFirestore.FieldValue;
};
