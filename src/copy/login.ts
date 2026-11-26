// Typed content for the OAuth login screen (public/login.html), rendered by
// scripts/gen-login.ts. This page is rendered per in-flight OAuth session
// (see src/oauth.ts's renderLoginPage) rather than served as a flat file at
// a fixed URL. It is reachable only via GET /authorize with a client's
// redirect_uri/state/client_id, and has zero SEO surface.

export interface LoginDoc {
    /** The name in the Brand hero. */
    title: string;
    /** The page's heading for screen readers; the hero draws the name. */
    heading: string;
    /** The line under the name. */
    tagline: string;
    /** Each box is named by its placeholder and by a label no one sees. */
    emailLabel: string;
    passwordLabel: string;
    inviteCodeLabel: string;
    continueButton: string;
    /** "By continuing you confirm..." — {terms}/{privacy} become the
     * names as plain text. Legal HTML is gone, so do not turn these into
     * anchors. */
    consentNote: string;
    termsLinkText: string;
    privacyLinkText: string;
    /** MCP OAuth login: "Sign in to connect" before the redirect hostname,
     * in place of the tagline. */
    signingInToConnect: string;
}

export interface LoginErrors {
    /** Sign-in refused because the login or password is wrong. Also what a
     * stranger sees once the owner exists: accounts are created by the owner
     * in Settings › Household, so there is no separate "sign-up closed" case
     * worth telling apart from a typo. */
    invalidCredentials: string;
    /** Auth backend could not answer (database down, timeout, rate limit). Kept apart
     * from invalidCredentials so a right password is never blamed. */
    signInUnavailable: string;
    /** Invite-policy deploy: no code on a new account. */
    inviteRequired: string;
    /** Invite-policy deploy: wrong, expired, or reused code. */
    invalidInvite: string;
    /** Invite codes are ignored when sign-up is closed. */
}

export const LOGIN: LoginDoc = {
    title: "Foodable",
    heading: "Sign in",
    tagline: "Your household's kitchen, in one place.",
    emailLabel: "Email or username",
    passwordLabel: "Password",
    inviteCodeLabel: "Invite code",
    continueButton: "Continue",
    consentNote:
        "By continuing you confirm you're 16 or older and agree to the {terms} and {privacy}.",
    termsLinkText: "Terms",
    privacyLinkText: "Privacy Policy",
    signingInToConnect: "Sign in to connect",
};

export const LOGIN_ERRORS: LoginErrors = {
    invalidCredentials: "Wrong email, username or password.",
    signInUnavailable: "Couldn't sign in right now. Try again in a minute.",
    inviteRequired: "An invite code is needed to create an account.",
    invalidInvite: "That invite code is invalid, expired, or already used.",
};
