/**
 * RossAI data model — see docs/ARCHITECTURE.md §3 and the build spec §2.
 * Columns marked ▲ in the doc are additions over the spec.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------- shared JSON shapes ----------

/** A grounded source. `quote` is the exact retrieved passage shown to the model. */
export type Citation = {
  title: string;
  url: string;
  quote: string;
  retrievedAt: string; // ISO timestamp
};

/** What the vision/extraction step pulled out of a document. */
export type ExtractedDocument = {
  docType: string; // model-classified type, e.g. "passport", "birth_certificate", "I-485"
  summary: string;
  fields: Record<string, string | null>; // e.g. { fullName, dateOfBirth, address, aNumber, expiration }
  blankRequiredFields?: string[];
  rawText?: string;
  legibilityNotes?: string;
};

/** Conversational intake progress, kept small on purpose (client anonymity). */
export type IntakeState = {
  step: "language" | "case_type" | "questions" | "done";
  answers: Record<string, string>;
  pendingQuestion?: string;
};

// ---------- enums ----------

export const caseStatusEnum = pgEnum("case_status", [
  "intake",
  "collecting_docs",
  "scanning",
  "awaiting_review",
  "replied",
  "closed",
]);

export const checklistStatusEnum = pgEnum("checklist_status", [
  "pending",
  "received",
  "rejected",
  "accepted",
]);

export const flagSeverityEnum = pgEnum("flag_severity", ["high", "medium", "low"]);

export const flagStatusEnum = pgEnum("flag_status", [
  "open",
  "approved",
  "edited",
  "rejected",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageChannelEnum = pgEnum("message_channel", ["sms", "email"]);
export const escalationStatusEnum = pgEnum("escalation_status", ["open", "replied", "dismissed"]);

// ---------- tables ----------

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").unique(),
  email: text("email"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    caseType: text("case_type"), // e.g. "I-485", "N-400", "I-130", "I-765", "I-90"; null while intake is in progress
    status: caseStatusEnum("status").notNull().default("intake"),
    assignedParalegalId: text("assigned_paralegal_id"),
    intakeState: jsonb("intake_state").$type<IntakeState>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cases_status_idx").on(t.status), index("cases_client_idx").on(t.clientId)],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    docName: text("doc_name").notNull(),
    description: text("description").notNull(),
    status: checklistStatusEnum("status").notNull().default("pending"),
    sourceCitation: jsonb("source_citation").$type<Citation | null>(),
    rejectionReason: text("rejection_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checklist_case_idx").on(t.caseId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    checklistItemId: uuid("checklist_item_id").references(() => checklistItems.id, {
      onDelete: "set null",
    }),
    storageUrl: text("storage_url").notNull(), // opaque key understood by src/lib/storage
    receivedVia: messageChannelEnum("received_via").notNull().default("email"),
    legibilityOk: boolean("legibility_ok"),
    verifiedType: text("verified_type"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    extracted: jsonb("extracted").$type<ExtractedDocument | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_case_idx").on(t.caseId)],
);

export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    fieldRef: text("field_ref").notNull(), // e.g. "I-485 Part 1, Item 7 (Date of Birth)"
    severity: flagSeverityEnum("severity").notNull(),
    description: text("description").notNull(), // one line: the problem
    proposedFix: text("proposed_fix").notNull(), // one line: the fix
    sourceCitation: jsonb("source_citation").$type<Citation>().notNull(),
    evidenceDocumentIds: jsonb("evidence_document_ids").$type<string[]>().notNull().default([]),
    status: flagStatusEnum("status").notNull().default("open"),
    editedText: text("edited_text"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("flags_case_idx").on(t.caseId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }), // null only before a case exists
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    channel: messageChannelEnum("channel").notNull(),
    body: text("body").notNull(),
    language: text("language").notNull().default("en"),
    approvedBy: text("approved_by"), // paralegal id for outbound free-text; "template:<name>" for operational templates
    externalId: text("external_id"),
    subject: text("subject"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_case_idx").on(t.caseId)],
);

export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    question: text("question").notNull(),
    reason: text("reason").notNull(), // why the agent escalated: "judgment" | "ungrounded" | "client_requested"
    draftReply: text("draft_reply"),
    draftCitation: jsonb("draft_citation").$type<Citation | null>(),
    status: escalationStatusEnum("status").notNull().default("open"),
    replyMessageId: uuid("reply_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("escalations_case_idx").on(t.caseId)],
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(), // "agent" | paralegal id
    action: text("action").notNull(), // e.g. "flag.approved", "message.sent", "document.rejected"
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_case_idx").on(t.caseId)],
);

// ---------- relations ----------

export const clientsRelations = relations(clients, ({ many }) => ({
  cases: many(cases),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  client: one(clients, { fields: [cases.clientId], references: [clients.id] }),
  checklistItems: many(checklistItems),
  documents: many(documents),
  flags: many(flags),
  messages: many(messages),
  escalations: many(escalations),
  auditEntries: many(auditEntries),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one, many }) => ({
  case: one(cases, { fields: [checklistItems.caseId], references: [cases.id] }),
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  case: one(cases, { fields: [documents.caseId], references: [cases.id] }),
  checklistItem: one(checklistItems, {
    fields: [documents.checklistItemId],
    references: [checklistItems.id],
  }),
}));

export const flagsRelations = relations(flags, ({ one }) => ({
  case: one(cases, { fields: [flags.caseId], references: [cases.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  case: one(cases, { fields: [messages.caseId], references: [cases.id] }),
}));

export const escalationsRelations = relations(escalations, ({ one }) => ({
  case: one(cases, { fields: [escalations.caseId], references: [cases.id] }),
}));

export const auditEntriesRelations = relations(auditEntries, ({ one }) => ({
  case: one(cases, { fields: [auditEntries.caseId], references: [cases.id] }),
}));

// ---------- row types ----------

export type Client = typeof clients.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Flag = typeof flags.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Escalation = typeof escalations.$inferSelect;
export type AuditEntry = typeof auditEntries.$inferSelect;

export type CaseStatus = Case["status"];
export type FlagSeverity = Flag["severity"];
export type FlagStatus = Flag["status"];
export type ChecklistStatus = ChecklistItem["status"];
