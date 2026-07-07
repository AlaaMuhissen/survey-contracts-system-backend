import request from "supertest";
import dotenv from "dotenv";

// Initialize .env before anything else
dotenv.config();

const BASE = "http://localhost:8080/api";
const SURVEY_ID = process.env.SURVEY_ID!;
const TOKENS = {
  super: process.env.SUPERADMIN_TOKEN!,
  survey: process.env.SURVEY_ADMIN_TOKEN!,
  contractor: process.env.CONTRACTOR_ADMIN_TOKEN!,
};

describe("Companies API", () => {
  it("survey admin can create company", async () => {
    const res = await request(BASE)
      .post(`/surveys/${SURVEY_ID}/companies`)
      .set("Authorization", `Bearer ${TOKENS.survey}`)
      .send({ name: "QA Company" });

    expect(res.status).toBe(200);
    expect(res.body.companyId).toBeTruthy();
  });

  it("rejects without token", async () => {
    const res = await request(BASE).get(`/surveys/${SURVEY_ID}/companies`);
    expect(res.status).toBe(401);
  });

  it("rejects wrong role", async () => {
    const res = await request(BASE)
      .post(`/surveys/${SURVEY_ID}/companies`)
      .set("Authorization", `Bearer ${TOKENS.contractor}`)
      .send({ name: "ShouldFail" });
    expect(res.status).toBe(403);
  });
});
