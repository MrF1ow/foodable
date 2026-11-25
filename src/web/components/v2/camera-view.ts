/**
 * The design's Camera view: a dark rounded stage with a green viewfinder frame
 * in its middle, the live picture of a scanner behind it. The picture is a
 * `<video>` the caller's script feeds (`[data-fd-camera-video]`); a static
 * preview swaps it for a plain dark feed, so a screenshot needs no camera.
 *
 * A view that is `hidden` (a screen with no camera) keeps its frame and draws
 * no feed, so nothing asks for the camera.
 *
 * Nothing is written on the view: what to do is the screen's title and the
 * field under it.
 *
 * Styles: `public/app/v2/scanner.css`.
 */
import { cls, dataAttrs, raw, type Html } from "./html.js";

export type CameraViewOptions = {
    /** A static dark feed in place of the live `<video>` (a preview shot). */
    preview?: boolean;
    /** Not drawn: a screen with no camera keeps the frame, hidden, with no feed. */
    hidden?: boolean;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function cameraView(opts: CameraViewOptions = {}): Html {
    const feed = opts.hidden
        ? ""
        : opts.preview
          ? `<div class="fd-camera-view__feed" aria-hidden="true"></div>`
          : `<video class="fd-camera-view__feed" data-fd-camera-video playsinline muted autoplay></video>`;
    return raw(
        `<div class="${cls("fd-camera-view", opts.className)}" data-fd-camera-view${opts.hidden ? " hidden" : ""}${dataAttrs(opts.data)}>${feed}<div class="fd-camera-view__frame" aria-hidden="true"></div></div>`,
    );
}
