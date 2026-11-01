export type AuthUser = {
    id: string;
    email: string;
    passwordHash: string | null;
};

export type AuthStore = {
    findByEmail(emailLower: string): Promise<AuthUser | null>;
    insertUser(input: { email: string; passwordHash: string }): Promise<string>;
    updatePasswordHash(id: string, hash: string): Promise<void>;
    countUsers(): Promise<number>;
    deleteUser(id: string): Promise<boolean>;
};

export class SignInError extends Error {
    constructor(
        message: string,
        readonly status: number | undefined,
        readonly code: string | undefined,
    ) {
        super(message);
        this.name = "SignInError";
    }
}

export class AlreadyRegisteredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AlreadyRegisteredError";
    }
}

// GoTrue: internal/api/token.go — InvalidLoginMessage
const INVALID_LOGIN_MESSAGE = "Invalid login credentials";

// GoTrue: internal/api/password.go — fmt.Sprintf("Password should be at least %d characters.", config.Password.MinLength)
const WEAK_PASSWORD_MESSAGE = "Password should be at least 6 characters.";

// GoTrue: internal/api/signup.go — ErrorCodeUserAlreadyExists
const USER_ALREADY_REGISTERED_MESSAGE = "User already registered";

// GoTrue: internal/api/mail.go — validateEmail / checkmail.ValidateFormat
const EMAIL_REQUIRED_MESSAGE = "An email address is required";
const EMAIL_TOO_LONG_MESSAGE = "An email address is too long";
const EMAIL_INVALID_FORMAT_MESSAGE =
    "Unable to validate email address: invalid format";

// checkmail.ValidateFormat (GoTrue v2.197.0), applied after trim in normalizeEmail.
const EMAIL_FORMAT_RE =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// GoTrue: internal/api/signup.go — empty password before MinLength check
const SIGNUP_PASSWORD_REQUIRED_MESSAGE = "Signup requires a valid password";

const MIN_PASSWORD_LENGTH = 6;

// Fixed bcrypt hash so unknown-email sign-in still runs Bun.password.verify.
export const DUMMY_PASSWORD_HASH =
    "$2b$10$5pc/WMgCYJtPxZ3BH1Ccz.jWAQFEavBIGuDkytwIuSpPn9WqjSJSK";

export type PasswordVerifier = (
    password: string,
    hash: string,
) => Promise<boolean>;

export type PasswordHasher = (password: string) => Promise<string>;

const defaultVerify: PasswordVerifier = (password, hash) =>
    Bun.password.verify(password, hash);

const defaultHash: PasswordHasher = (password) => Bun.password.hash(password);

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function validateEmailForSignUp(emailLower: string): void {
    if (emailLower === "") {
        throw new Error(EMAIL_REQUIRED_MESSAGE);
    }
    if (emailLower.length > 255) {
        throw new Error(EMAIL_TOO_LONG_MESSAGE);
    }
    if (!EMAIL_FORMAT_RE.test(emailLower)) {
        throw new Error(EMAIL_INVALID_FORMAT_MESSAGE);
    }
}

function isBcryptHash(hash: string): boolean {
    return (
        hash.startsWith("$2a$") ||
        hash.startsWith("$2b$") ||
        hash.startsWith("$2y$")
    );
}

export async function signUp(
    store: AuthStore,
    email: string,
    password: string,
    hashPassword: PasswordHasher = defaultHash,
): Promise<string> {
    // GoTrue's Signup checks the password (validateSignupParams, then
    // checkPasswordStrength) before validateEmail; keep that order so the
    // same input gets the same message.
    if (password === "") {
        throw new Error(SIGNUP_PASSWORD_REQUIRED_MESSAGE);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(WEAK_PASSWORD_MESSAGE);
    }
    const emailLower = normalizeEmail(email);
    validateEmailForSignUp(emailLower);
    const passwordHash = await hashPassword(password);
    try {
        return await store.insertUser({ email: emailLower, passwordHash });
    } catch (err) {
        if (err instanceof AlreadyRegisteredError) {
            throw new Error(USER_ALREADY_REGISTERED_MESSAGE);
        }
        throw err;
    }
}

export type SignInOptions = {
    verify?: PasswordVerifier;
    hash?: PasswordHasher;
};

export async function signIn(
    store: AuthStore,
    email: string,
    password: string,
    opts?: SignInOptions,
): Promise<string> {
    const verify = opts?.verify ?? defaultVerify;
    const hash = opts?.hash ?? defaultHash;
    const emailLower = normalizeEmail(email);
    const user = await store.findByEmail(emailLower);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const ok = await verify(password, passwordHash);
    if (!user || !ok) {
        throw new SignInError(
            INVALID_LOGIN_MESSAGE,
            400,
            "invalid_credentials",
        );
    }
    if (user.passwordHash && isBcryptHash(user.passwordHash)) {
        try {
            const upgraded = await hash(password);
            await store.updatePasswordHash(user.id, upgraded);
        } catch (err) {
            console.warn(
                `[auth] password rehash failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    return user.id;
}

export function createMemoryAuthStore(): AuthStore {
    const users = new Map<string, AuthUser>();

    return {
        async findByEmail(emailLower) {
            for (const user of users.values()) {
                if (user.email === emailLower) return { ...user };
            }
            return null;
        },
        async insertUser({ email, passwordHash }) {
            for (const user of users.values()) {
                if (user.email === email) {
                    throw new AlreadyRegisteredError(
                        USER_ALREADY_REGISTERED_MESSAGE,
                    );
                }
            }
            const id = crypto.randomUUID();
            users.set(id, { id, email, passwordHash });
            return id;
        },
        async updatePasswordHash(id, hash) {
            const user = users.get(id);
            if (!user) return;
            users.set(id, { ...user, passwordHash: hash });
        },
        async countUsers() {
            return users.size;
        },
        async deleteUser(id) {
            return users.delete(id);
        },
    };
}
