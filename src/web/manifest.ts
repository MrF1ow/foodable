import { THEME_COLOR, THEME_NAV_COLOR } from "../tokens.js";

export type WebAppManifest = {
    name: string;
    short_name: string;
    id: string;
    start_url: string;
    scope: string;
    display: "standalone";
    background_color: string;
    theme_color: string;
    icons: Array<{
        src: string;
        sizes?: string;
        type?: string;
        purpose?: string;
    }>;
    share_target: {
        action: string;
        method: "GET";
        params: {
            title: string;
            text: string;
            url: string;
        };
    };
};

export function buildWebAppManifest(): WebAppManifest {
    return {
        name: "Foodable",
        short_name: "Foodable",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: THEME_COLOR.light,
        theme_color: THEME_NAV_COLOR.light,
        icons: [
            {
                src: "/brand/icon-light.svg",
                sizes: "any",
                type: "image/svg+xml",
            },
            {
                src: "/icon-192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icon-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icon-maskable-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ],
        share_target: {
            action: "/share",
            method: "GET",
            params: {
                title: "title",
                text: "text",
                url: "url",
            },
        },
    };
}

export function manifestJson(): string {
    return `${JSON.stringify(buildWebAppManifest(), null, 2)}\n`;
}
