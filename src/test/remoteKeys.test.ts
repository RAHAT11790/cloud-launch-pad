import { describe, it, expect } from "vitest";
import { remoteActionFor, stepIndex, channelIndexFromDigits, stepVolume } from "@/lib/remoteKeys";

const free = { onControl: false, hasChannels: false, arrowsNavigate: false };
const live = { onControl: false, hasChannels: true, arrowsNavigate: false };

describe("remote key mapping", () => {
  it("OK / Enter toggles play-pause", () => {
    expect(remoteActionFor({ key: "Enter" }, free)).toBe("playPause");
    expect(remoteActionFor({ key: "MediaPlayPause" }, free)).toBe("playPause");
  });

  it("left/right seek", () => {
    expect(remoteActionFor({ key: "ArrowLeft" }, free)).toBe("seekBack");
    expect(remoteActionFor({ key: "ArrowRight" }, free)).toBe("seekFwd");
  });

  it("up/down change volume for episodes and channel for Live TV", () => {
    expect(remoteActionFor({ key: "ArrowUp" }, free)).toBe("volUp");
    expect(remoteActionFor({ key: "ArrowDown" }, free)).toBe("volDown");
    expect(remoteActionFor({ key: "ArrowUp" }, live)).toBe("chUp");
    expect(remoteActionFor({ key: "ArrowDown" }, live)).toBe("chDown");
  });

  it("channel keys always zap, even when a button is focused", () => {
    const ctx = { ...live, onControl: true };
    expect(remoteActionFor({ key: "ChannelUp" }, ctx)).toBe("chUp");
    expect(remoteActionFor({ key: "PageDown" }, ctx)).toBe("chDown");
    expect(remoteActionFor({ key: "Unidentified", keyCode: 427 }, ctx)).toBe("chUp");
  });

  it("back keys from TV remotes close", () => {
    expect(remoteActionFor({ key: "Escape" }, free)).toBe("back");
    expect(remoteActionFor({ key: "GoBack" }, free)).toBe("back");
    expect(remoteActionFor({ key: "XF86Back", keyCode: 10009 }, free)).toBe("back");
    expect(remoteActionFor({ key: "Unidentified", keyCode: 461 }, free)).toBe("back");
  });

  it("a focused control keeps arrows and Enter for itself", () => {
    const ctx = { ...free, onControl: true };
    expect(remoteActionFor({ key: "Enter" }, ctx)).toBeNull();
    expect(remoteActionFor({ key: "ArrowLeft" }, ctx)).toBeNull();
  });

  it("M mutes and +/- change volume even when a button is focused", () => {
    const ctx = { ...free, onControl: true };
    expect(remoteActionFor({ key: "m" }, ctx)).toBe("mute");
    expect(remoteActionFor({ key: "+" }, ctx)).toBe("volUp");
    expect(remoteActionFor({ key: "-" }, ctx)).toBe("volDown");
  });

  it("with TV controls visible, up/down move focus", () => {
    expect(remoteActionFor({ key: "ArrowDown" }, { ...live, arrowsNavigate: true })).toBeNull();
    expect(remoteActionFor({ key: "ArrowLeft" }, { ...live, arrowsNavigate: true })).toBe("seekBack");
  });

  it("number keys pick channels only on Live TV", () => {
    expect(remoteActionFor({ key: "7" }, live)).toBe("digit");
    expect(remoteActionFor({ key: "7" }, free)).toBeNull();
  });
});

describe("channel and volume steps", () => {
  it("channels wrap around, episodes stop", () => {
    expect(stepIndex(5, 4, 1, true)).toBe(0);
    expect(stepIndex(5, 0, -1, true)).toBe(4);
    expect(stepIndex(5, 4, 1, false)).toBeNull();
    expect(stepIndex(5, 2, -1, false)).toBe(1);
  });

  it("typed channel numbers are 1-based", () => {
    expect(channelIndexFromDigits("3", 10)).toBe(2);
    expect(channelIndexFromDigits("11", 10)).toBeNull();
    expect(channelIndexFromDigits("0", 10)).toBeNull();
  });

  it("volume moves 10 per press and stays in 0..100", () => {
    expect(stepVolume(50, 1)).toBe(60);
    expect(stepVolume(95, 1)).toBe(100);
    expect(stepVolume(5, -1)).toBe(0);
  });
});
