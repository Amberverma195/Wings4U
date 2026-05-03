export type BxgySizeFilter =
  | {
      kind: "weight_lb";
      weightLb: number;
      label: string;
    }
  | {
      kind: "modifier_option";
      modifierOptionId: string;
      label: string;
    };

export type BxgyExtras = {
  qualifyingSize: BxgySizeFilter | null;
  rewardSize: BxgySizeFilter | null;
  labels: {
    qualifying: string | null;
    reward: string | null;
  };
};

export const EMPTY_BXGY_EXTRAS: BxgyExtras = {
  qualifyingSize: null,
  rewardSize: null,
  labels: { qualifying: null, reward: null },
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseSizeFilter(value: unknown): BxgySizeFilter | null {
  const obj = asObject(value);
  if (!obj) return null;

  const kind = typeof obj.kind === "string" ? obj.kind : null;
  const label =
    typeof obj.label === "string" && obj.label.trim()
      ? obj.label.trim()
      : "";

  if (kind === "weight_lb") {
    const weightLb = Number(obj.weightLb);
    if (!Number.isFinite(weightLb) || weightLb <= 0) return null;
    return {
      kind: "weight_lb",
      weightLb,
      label: label || `${weightLb}lb`,
    };
  }

  if (kind === "modifier_option") {
    const modifierOptionId =
      typeof obj.modifierOptionId === "string" ? obj.modifierOptionId : "";
    if (!modifierOptionId) return null;
    return {
      kind: "modifier_option",
      modifierOptionId,
      label: label || "Selected size",
    };
  }

  return null;
}

export function readBxgyExtras(rulePayloadJson: unknown): BxgyExtras {
  const root = asObject(rulePayloadJson);
  const bxgy = root ? asObject(root.bxgy) : null;
  if (!bxgy) return EMPTY_BXGY_EXTRAS;

  const labels = asObject(bxgy.labels);
  return {
    qualifyingSize: parseSizeFilter(bxgy.qualifyingSize),
    rewardSize: parseSizeFilter(bxgy.rewardSize),
    labels: {
      qualifying:
        typeof labels?.qualifying === "string" ? labels.qualifying : null,
      reward: typeof labels?.reward === "string" ? labels.reward : null,
    },
  };
}

export function withBxgyExtras(
  rulePayloadJson: unknown,
  extras: BxgyExtras | null,
): Record<string, unknown> {
  const base = asObject(rulePayloadJson) ?? {};

  if (!extras) {
    const next = { ...base };
    delete next.bxgy;
    return next;
  }

  return {
    ...base,
    bxgy: {
      qualifyingSize: extras.qualifyingSize,
      rewardSize: extras.rewardSize,
      labels: extras.labels,
    },
  };
}
