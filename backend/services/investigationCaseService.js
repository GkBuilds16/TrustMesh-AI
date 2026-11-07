
import mongoose from "mongoose";
import InvestigationCase from "../models/InvestigationCase.js";
import Seller from "../models/Seller.js";
import InvestigationCaseAudit from "../models/InvestigationCaseAudit.js";


const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const defaultAuditWriter = (events, session) =>
  InvestigationCaseAudit.create(events, {
    session,
    ordered: true,
  });

let auditWriter = defaultAuditWriter;

export function setAuditWriterForTests(writer) {
  const previousWriter = auditWriter;
  auditWriter = writer ?? defaultAuditWriter;

  return () => {
    auditWriter = previousWriter;
  };
}

function validateUserId(userId) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new Error("A valid authenticated user ID is required.");
  }
}

function validateSellerId(sellerId) {
  if (
    typeof sellerId !== "string" ||
    !sellerId.trim() ||
    sellerId.trim().length > 100
  ) {
    throw new Error("A valid sellerId is required.");
  }

  return sellerId.trim();
}

export async function listInvestigationCases({
  userId,
  sellerId,
  status,
} = {}) {
  validateUserId(userId);

  const filter = { createdBy: userId };

  if (sellerId !== undefined) {
    filter.sellerId = validateSellerId(sellerId);
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error("Invalid investigation case status.");
    }

    filter.status = status;
  }

  return InvestigationCase.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}


export async function createInvestigationCase({
  userId,
  sellerId,
  action,
} = {}) {
  validateUserId(userId);

  const normalizedSellerId = validateSellerId(sellerId);

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("A valid investigation action is required.");
  }

  const { id, title, priority } = action;

  if (
    typeof id !== "string" ||
    !id.trim() ||
    id.trim().length > 100 ||
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 200 ||
    !["HIGH", "MEDIUM", "LOW"].includes(priority)
  ) {
    throw new Error("Investigation action details are invalid.");
  }

  const seller = await Seller.findOne({
    sellerId: normalizedSellerId,
  })
    .select("sellerId")
    .lean();

  if (!seller) {
    const error = new Error("Seller not found.");
    error.code = "SELLER_NOT_FOUND";
    throw error;
  }

  const existingCase = await InvestigationCase.findOne({
    createdBy: userId,
    sellerId: normalizedSellerId,
    actionId: id.trim(),
  }).lean();

  if (existingCase) {
    return existingCase;
  }

  const session = await mongoose.startSession();

  try {
    let createdCase;

    await session.withTransaction(async () => {
      const [newCase] = await InvestigationCase.create(
        [
          {
            sellerId: normalizedSellerId,
            actionId: id.trim(),
            actionTitle: title.trim(),
            priority,
            createdBy: userId,
            status: "OPEN",
          },
        ],
        { session }
      );

      await InvestigationCaseAudit.create(
        [
          {
            caseId: newCase._id,
            sellerId: normalizedSellerId,
            actorId: userId,
            eventType: "CASE_CREATED",
            previousStatus: null,
            newStatus: "OPEN",
            notesChanged: false,
          },
        ],
        { session }
      );

      createdCase = newCase.toObject();
    });

    return createdCase;
  } catch (error) {
    // Handle a concurrent duplicate creation safely.
    if (error.code === 11000) {
      const existing = await InvestigationCase.findOne({
        createdBy: userId,
        sellerId: normalizedSellerId,
        actionId: id.trim(),
      }).lean();

      if (existing) {
        return existing;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
}



export async function updateInvestigationCase({
  userId,
  caseId,
  status,
  resolutionNotes,
} = {}) {
  validateUserId(userId);

  if (!mongoose.isValidObjectId(caseId)) {
    throw new Error("A valid investigation case ID is required.");
  }

  if (!VALID_STATUSES.includes(status)) {
    throw new Error("Invalid investigation case status.");
  }

  if (
    resolutionNotes !== undefined &&
    (typeof resolutionNotes !== "string" ||
      resolutionNotes.length > 2000)
  ) {
    throw new Error(
      "Resolution notes must be a string of at most 2000 characters."
    );
  }

  const session = await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(async () => {
      const existingCase = await InvestigationCase.findOne({
        _id: caseId,
        createdBy: userId,
      }).session(session);

      if (!existingCase) {
        result = null;
        return;
      }

      if (
        existingCase.status === "RESOLVED" &&
        status !== "RESOLVED"
      ) {
        const error = new Error(
          "A resolved case cannot be reopened through this endpoint."
        );
        error.code = "CASE_ALREADY_RESOLVED";
        throw error;
      }

      const previousStatus = existingCase.status;
      const previousNotes = existingCase.resolutionNotes ?? "";
      const nextNotes =
        resolutionNotes === undefined
          ? previousNotes
          : resolutionNotes.trim();

      const statusChanged = previousStatus !== status;
      const notesChanged = previousNotes !== nextNotes;

      existingCase.status = status;
      existingCase.resolutionNotes = nextNotes;

      existingCase.resolvedAt =
        status === "RESOLVED"
          ? existingCase.resolvedAt || new Date()
          : null;

      await existingCase.save({ session });

      const auditEvents = [];

      if (statusChanged) {
        auditEvents.push({
          caseId: existingCase._id,
          sellerId: existingCase.sellerId,
          actorId: userId,
          eventType:
            status === "RESOLVED"
              ? "CASE_RESOLVED"
              : "STATUS_CHANGED",
          previousStatus,
          newStatus: status,
          notesChanged: false,
        });
      }

      if (notesChanged) {
        auditEvents.push({
          caseId: existingCase._id,
          sellerId: existingCase.sellerId,
          actorId: userId,
          eventType: "NOTES_UPDATED",
          previousStatus,
          newStatus: status,
          notesChanged: true,
        });
      }

      if (auditEvents.length > 0) {
       await auditWriter(auditEvents, session);
      }

      result = existingCase.toObject();
    });

    return result;
  } finally {
    await session.endSession();
  }
}
