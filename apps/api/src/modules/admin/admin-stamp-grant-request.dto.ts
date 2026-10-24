import { Transform } from "class-transformer";
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import type { AdminStampGrantInput, StampGrantReason } from "./admin-customers.dto";
import { MAX_AVAILABLE_STAMPS } from "../rewards/rewards.service";

export class AdminStampGrantRequestDto implements AdminStampGrantInput {
  // Prevent implicit conversion from accepting true as 1 or numeric strings.
  @Transform(({ obj }) => typeof obj.stamps === "number" ? obj.stamps : Number.NaN)
  @IsInt()
  @Min(1)
  @Max(MAX_AVAILABLE_STAMPS)
  stamps!: number;

  @IsIn(["WRONG_ORDER", "MISSING_ITEMS", "SERVICE_RECOVERY", "OTHER"])
  reason!: StampGrantReason;

  @ValidateIf((input: AdminStampGrantRequestDto) => input.reason === "OTHER" || input.note !== undefined)
  @Transform(({ obj }) => typeof obj.note === "string" ? obj.note.trim() : obj.note)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note?: string;

  @IsUUID("4")
  request_id!: string;
}
