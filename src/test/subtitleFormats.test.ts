import { describe, expect, it } from "vitest";
import { cleanSubtitleText, decodeSubtitleBytes, detectSubtitleKind, parseSubtitleFile, uniqueLines } from "@/lib/subtitleFormats";

describe("subtitle files of every common format", () => {
  it("SRT with styling tags and {\\an8}", () => {
    const cues = parseSubtitleFile("1\r\n00:00:01,500 --> 00:00:03,000\r\n{\\an8}<i>Hello</i> <font color=\"#fff\">there</font>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nTom &amp; Jerry\r\n");
    expect(cues).toEqual([{ start: 1.5, end: 3, text: "Hello there" }, { start: 4, end: 5.25, text: "Tom & Jerry" }]);
  });
  it("WebVTT with cue settings, voice tags and karaoke times", () => {
    const cues = parseSubtitleFile("WEBVTT\n\nNOTE hi\n\n00:01.000 --> 00:02.000 line:0%\n<v Ana>Hi <00:01.500>you</v>\n\n00:00:03.000 --> 00:00:04.000\n<c.yellow>Two</c>");
    expect(cues).toEqual([{ start: 1, end: 2, text: "Hi you" }, { start: 3, end: 4, text: "Two" }]);
  });
  it("ASS/SSA: override tags, \\N breaks, commas in text, drawings dropped", () => {
    const ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Wait,{\\i0} what?\\NNo way\nDialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\n";
    expect(detectSubtitleKind(ass)).toBe("ass");
    expect(parseSubtitleFile(ass)).toEqual([{ start: 1, end: 2.5, text: "Wait, what?\nNo way" }]);
  });
  it("YouTube SBV", () => {
    expect(parseSubtitleFile("0:00:01.000,0:00:02.000\nFirst[br]line\n\n0:00:03.000,0:00:04.500\nSecond")).toEqual([
      { start: 1, end: 2, text: "First\nline" }, { start: 3, end: 4.5, text: "Second" },
    ]);
  });
  it("TTML / DFXP with seconds, ticks and <br/>", () => {
    const ttml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><body><div><p begin="1.5s" end="3s">One<br/>Two</p><p begin="40000000t" end="50000000t">Tick</p></div></body></tt>';
    expect(parseSubtitleFile(ttml)).toEqual([{ start: 1.5, end: 3, text: "One\nTwo" }, { start: 4, end: 5, text: "Tick" }]);
  });
  it("SAMI (.smi)", () => {
    const smi = "<SAMI><BODY><SYNC Start=1000><P Class=ENCC>Hello<br>World<SYNC Start=2500><P Class=ENCC>&nbsp;<SYNC Start=3000><P>Bye</BODY></SAMI>";
    const cues = parseSubtitleFile(smi);
    expect(cues[0]).toEqual({ start: 1, end: 2.5, text: "Hello\nWorld" });
    expect(cues[cues.length - 1].text).toBe("Bye");
  });
  it("MicroDVD (.sub) with declared frame rate", () => {
    expect(parseSubtitleFile("{1}{1}25.000\n{25}{50}Hi|there\n")).toEqual([{ start: 1, end: 2, text: "Hi\nthere" }]);
  });
  it("Windows-1252 and UTF-16 files are read in their real encoding", () => {
    const latin = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café" in Windows-1252
    expect(decodeSubtitleBytes(latin)).toBe("Café");
    const u16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect(decodeSubtitleBytes(u16)).toBe("Hi");
    expect(decodeSubtitleBytes(new TextEncoder().encode("হ্যালো"))).toBe("হ্যালো");
  });
  it("in-file SRT lines lose {\\an8} and tags; layered duplicates show once", () => {
    expect(cleanSubtitleText("{\\an8}<b>Top</b>", "srt")).toBe("Top");
    expect(uniqueLines(["Same", "Same", "Other"])).toBe("Same\nOther");
  });
});
