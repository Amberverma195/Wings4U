-- PRD §12.3: link chat-initiated cancellation requests to the conversation
ALTER TABLE "cancellation_requests"
  ADD COLUMN "chat_thread_id" UUID NULL;

ALTER TABLE "cancellation_requests"
  ADD CONSTRAINT "cancellation_requests_chat_thread_id_fkey"
  FOREIGN KEY ("chat_thread_id") REFERENCES "order_conversations"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_cancellation_requests_chat_thread"
  ON "cancellation_requests" ("chat_thread_id")
  WHERE "chat_thread_id" IS NOT NULL;
