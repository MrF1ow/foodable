import { expect, test } from "bun:test";
import { cameraView } from "./camera-view.js";

test("a live view is a video under the green frame, and says nothing", () => {
    const html = String(cameraView());
    expect(html).toStartWith(
        '<div class="fd-camera-view" data-fd-camera-view><video class="fd-camera-view__feed" data-fd-camera-video playsinline muted autoplay></video>',
    );
    expect(html).toContain(
        '<div class="fd-camera-view__frame" aria-hidden="true"></div>',
    );
    expect(html).not.toMatch(/<p|<h\d|aria-label/);
});

test("a static preview has a dark feed and no video", () => {
    const html = String(cameraView({ preview: true }));
    expect(html).toContain(
        '<div class="fd-camera-view__feed" aria-hidden="true"></div>',
    );
    expect(html).not.toContain("<video");
});

test("a hidden view draws no feed, so nothing asks for the camera", () => {
    const html = String(cameraView({ hidden: true }));
    expect(html).toContain(" hidden");
    expect(html).not.toContain("__feed");
    expect(html).not.toContain("<video");
});

test("class and data hooks are escaped", () => {
    const html = String(
        cameraView({ className: 'a"b', data: { "fd-x": '"><i>' } }),
    );
    expect(html).not.toContain("<i>");
    expect(html).toContain("fd-camera-view a&quot;b");
});
