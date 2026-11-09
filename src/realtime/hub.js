import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { PLATFORM_ROLE, isPlatformAdminToken } from "../middleware/platformAuth.js";

// In-memory registry: fine for a single backend instance. Running several
// instances behind a load balancer needs a shared pub/sub (e.g. Redis) so an
// event raised on one instance reaches sockets held by the others.
const clients = new Set();

const HEARTBEAT_MS = 30_000;

const send = (ws, message) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
};

export const attachRealtime = (server) => {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 });

  wss.on("connection", async (ws, req) => {
    ws.on("error", () => {});
    const token = new URL(req.url, "http://localhost").searchParams.get("token");
    let user;
    try {
      user = jwt.verify(token || "", process.env.JWT_SECRET);
    } catch {
      ws.close(4001, "Invalid or expired token");
      return;
    }

    let isPlatform = false;
    if (user.role === PLATFORM_ROLE) {
      try {
        isPlatform = await isPlatformAdminToken(user);
      } catch {
        ws.close(1011, "Could not verify account");
        return;
      }
      if (!isPlatform) {
        ws.close(4003, "Platform admin access required");
        return;
      }
    } else if (!user.tenant_schema) {
      ws.close(4003, "Account is not linked to an organization");
      return;
    }

    const client = {
      ws,
      isPlatform,
      isPartner: user.role === "partner" && !user.is_employee,
      tenantSchema: isPlatform ? null : user.tenant_schema,
      userId: user.id,
      expiresAt: user.exp ? user.exp * 1000 : null,
    };
    clients.add(client);
    ws.isAlive = true;

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", () => {});
    ws.on("close", () => clients.delete(client));

    send(ws, { type: "hello", role: user.role, tenantSchema: client.tenantSchema });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      const { ws } = client;
      if (client.expiresAt && client.expiresAt <= now) {
        ws.close(4001, "Token expired");
        continue;
      }
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
};

export const publish = (filter, message) => {
  const payload = { ...message, ts: new Date().toISOString() };
  for (const client of clients) {
    if (filter(client)) send(client.ws, payload);
  }
};

export const toPlatform = () => (c) => c.isPlatform;
export const toTenantStaff = (schema) => (c) => !c.isPlatform && !c.isPartner && c.tenantSchema === schema;
export const toTenantAll = (schema) => (c) => !c.isPlatform && c.tenantSchema === schema;
export const toTenantPartners = (schema) => (c) => c.isPartner && c.tenantSchema === schema;

// Drop a user's live connections at once (e.g. an employee was deactivated or deleted).
export const disconnectUser = (schema, userId) => {
  for (const client of clients) {
    if (client.tenantSchema === schema && String(client.userId) === String(userId)) {
      client.ws.close(4001, "Account no longer active");
    }
  }
};
export const toPartner = (schema, partnerId) => (c) =>
  c.isPartner && c.tenantSchema === schema && String(c.userId) === String(partnerId);

export const connectedCount = () => clients.size;
