import { describe, it, expect } from "vitest";
import { cleanCard, cleanBio, cleanName, nameError, BIO_MAX, GENRES_MAX } from "@/lib/profileCard";

describe("edit profile card rules", () => {
  it("bio is cut at 120 characters and loses hidden control characters", () => {
    expect(cleanBio("a".repeat(200))).toHaveLength(BIO_MAX);
    expect(cleanBio("hi\u0000\u202ethere")).toBe("hithere");
    expect(cleanBio("one\n\n\n\n\ntwo")).toBe("one\n\ntwo");
  });
  it("keeps at most 5 known genres, no duplicates, and drops unknown ones", () => {
    const c = cleanCard({ genres: ["Action", "Action", "Hacked<script>", "Comedy", "Drama", "Fantasy", "Isekai", "Romance"] });
    expect(c.genres).toEqual(["Action", "Comedy", "Drama", "Fantasy", "Isekai"]);
    expect(c.genres.length).toBe(GENRES_MAX);
  });
  it("only allows listed moods and glow colours", () => {
    expect(cleanCard({ mood: "binge", accent: "ocean" })).toMatchObject({ mood: "binge", accent: "ocean" });
    expect(cleanCard({ mood: "evil", accent: "#ff0000" })).toMatchObject({ mood: "", accent: "" });
  });
  it("display name needs 2–30 characters", () => {
    expect(nameError("A")).not.toBe("");
    expect(nameError("Ra")).toBe("");
    expect(cleanName("x".repeat(40))).toHaveLength(30);
    expect(cleanName("  Rahat   Sarker <b> ")).toBe("Rahat Sarker b");
  });
});
