-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kyc_inquiry_id" TEXT,
ADD COLUMN     "kyc_status" TEXT;

-- CreateTable
CREATE TABLE "kyc_verification_records" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_verification_records_user_id_idx" ON "kyc_verification_records"("user_id");

-- AddForeignKey
ALTER TABLE "kyc_verification_records" ADD CONSTRAINT "kyc_verification_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
