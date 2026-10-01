import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
const derivePassword = promisify(scrypt);
type OwnerAccount = { id: string; salt: string; passwordHash: string };
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
  ) {}
  async status() {
    const account = await this.db.get<OwnerAccount>("system", "accounts", "owner");
    return {
      method:
        account || this.config.ownerSetupKey ? ("password" as const) : ("access-key" as const),
      setupRequired: Boolean(this.config.ownerSetupKey && !account),
    };
  }
  async setup(setupKey: string, password: string) {
    if (
      !this.config.ownerSetupKey ||
      !timingSafeEqual(digest(setupKey), digest(this.config.ownerSetupKey))
    )
      throw new AppError("Owner setup code is incorrect", 401);
    if (password.length < 12 || Buffer.byteLength(password) > 1024)
      throw new AppError("Choose a password of at least 12 characters (up to 1024 bytes)", 400);
    if (await this.db.get("system", "accounts", "owner"))
      throw new AppError("Owner setup is already complete. Sign in instead.", 409);
    const salt = randomBytes(32).toString("base64");
    const passwordHash = ((await derivePassword(password, salt, 64)) as Buffer).toString("base64");
    if (!(await this.db.insertIfAbsent("system", "accounts", { id: "owner", salt, passwordHash })))
      throw new AppError("Owner setup is already complete. Sign in instead.", 409);
    // Any old access-key sessions cease to be valid when the account is claimed.
    const sessions = await this.db.list<{ id: string }>("system", "sessions");
    for (const session of sessions) await this.db.remove("system", "sessions", session.id);
    return this.issueSession();
  }
  async session(accessKey?: string, password?: string) {
    const account = await this.db.get<OwnerAccount>("system", "accounts", "owner");
    if (account || this.config.ownerSetupKey) {
      if (!account) throw new AppError("Complete owner setup before signing in", 401);
      if (!password || Buffer.byteLength(password) > 1024)
        throw new AppError("Password is incorrect", 401);
      const actual = (await derivePassword(password, account.salt, 64)) as Buffer;
      if (!timingSafeEqual(actual, Buffer.from(account.passwordHash, "base64")))
        throw new AppError("Password is incorrect", 401);
      return this.issueSession();
    }
    if (
      this.config.mode === "live" &&
      (!accessKey ||
        !this.config.accessKey ||
        !timingSafeEqual(digest(accessKey), digest(this.config.accessKey)))
    )
      throw new AppError("Access key is incorrect", 401);
    return this.issueSession();
  }
  private async issueSession() {
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner: "local-user",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return { token, mode: this.config.mode };
  }
  async logout(authorization?: string) {
    await this.owner(authorization);
    await this.db.remove(
      "system",
      "sessions",
      digest(authorization?.slice(7) ?? "").toString("hex"),
    );
  }
  async owner(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to OpenMuse", 401);
    const session = await this.db.get<{ owner: string; expiresAt: number }>(
      "system",
      "sessions",
      digest(authorization.slice(7)).toString("hex"),
    );
    if (!session || session.expiresAt < Date.now())
      throw new AppError("Session expired. Sign in again.", 401);
    return session.owner;
  }
  sign(owner: string, path: string) {
    const expires = String(Date.now() + 15 * 60 * 1000);
    const signature = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${path}\n${expires}`)
      .digest("hex");
    return `${this.config.publicUrl}${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature}`;
  }
  verify(url: URL) {
    const owner = url.searchParams.get("owner") ?? "";
    const expires = url.searchParams.get("expires") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    if (
      !owner ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !/^\w{64}$/.test(signature)
    )
      throw new AppError("Document link expired; refresh the workspace", 401);
    const expected = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${url.pathname}\n${expires}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new AppError("Invalid access link", 403);
    return owner;
  }
}
export async function createAuth(db: Store, config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, "session-signing-key");
  let key: string;
  try {
    key = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    key = randomBytes(32).toString("base64");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
  }
  return new Auth(db, config, key);
}
