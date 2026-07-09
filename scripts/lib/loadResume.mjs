import fs from "node:fs/promises";
import path from "node:path";

// Load the resume profile, preferring the RESUME_PROFILE_JSON env var so
// production (Vercel) never depends on data/resume-profile.json being present
// in the deployment. That file is gitignored to keep personal data out of the
// repo, which also excludes it from the serverless bundle - reading it there
// throws ENOENT and the whole run fails before any email is sent. Falls back
// to the local file for development.
export async function loadResumeProfile() {
  const raw = process.env.RESUME_PROFILE_JSON;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`RESUME_PROFILE_JSON is set but is not valid JSON: ${error.message}`);
    }
  }

  const filePath = path.join(process.cwd(), "data", "resume-profile.json");
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "No resume profile found. Set the RESUME_PROFILE_JSON environment variable " +
        "(recommended for Vercel) or create data/resume-profile.json from data/resume-profile.example.json."
      );
    }
    throw error;
  }
}
