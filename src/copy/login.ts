// Typed content for the OAuth login screen (public/login.html), rendered by
// scripts/gen-login.ts. This page is rendered per in-flight OAuth session
// (see src/oauth.ts's renderLoginPage) rather than served as a flat file at
// a fixed URL. It is reachable only via GET /authorize with a client's
// redirect_uri/state/client_id, and has zero SEO surface.

export interface LoginDoc {
    title: string;
    subtitle: string;
    emailLabel: string;
    passwordLabel: string;
    continueButton: string;
    /** "By continuing you confirm..." — {terms}/{privacy} become the
     * localized names as plain text. Legal HTML is gone, so do not turn
     * these into anchors. */
    consentNote: string;
    termsLinkText: string;
    privacyLinkText: string;
    newHereNote: string;
    afterConnectNote: string;
    /** One line under the card. */
    footerNote: string;
    /** MCP OAuth login: "Signing in to connect" before the redirect hostname. */
    signingInToConnect: string;
}

export interface LoginErrors {
    /** Sign-in refused because the login or password is wrong. Also what a
     * stranger sees once the owner exists: accounts are created by the owner
     * in Household › Members, so there is no separate "sign-up closed" case
     * worth telling apart from a typo. */
    invalidCredentials: string;
    /** Auth backend could not answer (database down, timeout, rate limit). Kept apart
     * from invalidCredentials so a right password is never blamed. */
    signInUnavailable: string;
}

export const LOGIN: LoginDoc = {
    title: "Foodable",
    subtitle: "Sign in to connect",
    emailLabel: "Email or username",
    passwordLabel: "Password",
    continueButton: "Continue",
    consentNote:
        "By continuing you confirm you're at least 16 and agree to the {terms} and {privacy}.",
    termsLinkText: "Terms of Service",
    privacyLinkText: "Privacy Policy",
    newHereNote:
        "Sign in with the email or username and password the household owner gave you.",
    afterConnectNote:
        "After successful connection in your client, save your password somewhere and close this browser tab.",
    footerNote:
        "Free and open source. Nutrition figures are estimates, not medical advice.",
    signingInToConnect: "Signing in to connect",
};

export const LOGIN_ERRORS: LoginErrors = {
    invalidCredentials: "Wrong email, username or password.",
    signInUnavailable: "Couldn't sign in right now. Try again in a minute.",
};
