-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('female', 'male', 'non_binary', 'other');

-- CreateEnum
CREATE TYPE "Orientation" AS ENUM ('heterosexual', 'homosexual', 'bisexual', 'pansexual', 'other');

-- CreateEnum
CREATE TYPE "LookingFor" AS ENUM ('relationship', 'casual', 'friendship', 'network', 'unspecified');

-- CreateEnum
CREATE TYPE "PremiumTier" AS ENUM ('free', 'premium', 'premium_plus');

-- CreateEnum
CREATE TYPE "VisibilityMode" AS ENUM ('visible', 'anonymous');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('active', 'expired', 'unmatched', 'blocked');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'photo_temp', 'audio', 'location', 'gif', 'system');

-- CreateEnum
CREATE TYPE "PhotoSource" AS ENUM ('user_upload', 'facebook', 'instagram');

-- CreateEnum
CREATE TYPE "SealType" AS ENUM ('cafeteria', 'praieiro', 'roadie', 'boemio', 'natureza', 'urbanista', 'fitness', 'cultural');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'reviewing', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "POICategory" AS ENUM ('bar', 'restaurant', 'cafe', 'park', 'shopping', 'gym', 'show', 'event', 'beach', 'museum', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255),
    "name" VARCHAR(50) NOT NULL,
    "birth_date" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "orientation" "Orientation",
    "looking_for" "LookingFor" NOT NULL DEFAULT 'unspecified',
    "bio" TEXT,
    "premium_tier" "PremiumTier" NOT NULL DEFAULT 'free',
    "premium_expires_at" TIMESTAMP(3),
    "visibility_mode" "VisibilityMode" NOT NULL DEFAULT 'anonymous',
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_until" TIMESTAMP(6),
    "show_distance" BOOLEAN NOT NULL DEFAULT true,
    "show_age" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(6),
    "verification_selfie_url" VARCHAR(500),
    "profile_completeness" SMALLINT NOT NULL DEFAULT 0,
    "data_retention_until" DATE,
    "deleted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "last_active_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "thumbnail_url" VARCHAR(500),
    "order_index" SMALLINT NOT NULL DEFAULT 0,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "source" "PhotoSource" NOT NULL DEFAULT 'user_upload',
    "is_face_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "icon" VARCHAR(50),
    "category" VARCHAR(50),

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_interests" (
    "user_id" UUID NOT NULL,
    "interest_id" SMALLINT NOT NULL,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id","interest_id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "geohash" VARCHAR(12) NOT NULL,
    "accuracy_meters" SMALLINT,
    "poi_id" BIGINT,
    "city" VARCHAR(100),
    "state" CHAR(2),
    "recorded_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pois" (
    "id" BIGSERIAL NOT NULL,
    "external_id" VARCHAR(100),
    "name" VARCHAR(255) NOT NULL,
    "category" "POICategory" NOT NULL,
    "subcategory" VARCHAR(50),
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "state" CHAR(2),
    "neighborhood" VARCHAR(100),
    "rating" DECIMAL(2,1),
    "total_ratings" INTEGER NOT NULL DEFAULT 0,
    "phone" VARCHAR(30),
    "website" VARCHAR(500),
    "hours" JSONB,
    "photos" JSONB,
    "is_partner" BOOLEAN NOT NULL DEFAULT false,
    "partner_offer" TEXT,
    "source" VARCHAR(20) NOT NULL DEFAULT 'osm',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "last_verified_at" TIMESTAMP(6),

    CONSTRAINT "pois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pois_checkins" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "poi_id" BIGINT NOT NULL,
    "checkin_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_minutes" INTEGER,

    CONSTRAINT "pois_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" BIGSERIAL NOT NULL,
    "liker_id" UUID NOT NULL,
    "liked_id" UUID NOT NULL,
    "is_super" BOOLEAN NOT NULL DEFAULT false,
    "location_id" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "location_id" BIGINT,
    "poi_id" BIGINT,
    "context_text" VARCHAR(255),
    "status" "MatchStatus" NOT NULL DEFAULT 'active',
    "chat_expires_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_renewed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT,
    "message_type" "MessageType" NOT NULL DEFAULT 'text',
    "media_url" VARCHAR(500),
    "media_expires_at" TIMESTAMP(6),
    "lat" DECIMAL(10,8),
    "lng" DECIMAL(11,8),
    "read_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" BIGSERIAL NOT NULL,
    "visitor_id" UUID NOT NULL,
    "visited_id" UUID NOT NULL,
    "was_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "visited_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seals" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "seal_type" "SealType" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 1,
    "target" INTEGER NOT NULL DEFAULT 5,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "earned_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "seals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" BIGSERIAL NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID,
    "reported_id" UUID NOT NULL,
    "reason" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "evidence_urls" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(6),
    "action_taken" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tier" "PremiumTier" NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "original_transaction_id" VARCHAR(255),
    "product_id" VARCHAR(100),
    "starts_at" TIMESTAMP(6) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "cancelled_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boosts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "visibility_radius_meters" INTEGER NOT NULL DEFAULT 5000,
    "amount_cents" INTEGER NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "transaction_id" VARCHAR(255),

    CONSTRAINT "boosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMP(6),
    "sent_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "retry_count" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "app_version" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_phone" ON "users"("phone");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_premium" ON "users"("premium_tier");

-- CreateIndex
CREATE INDEX "idx_users_active" ON "users"("last_active_at" DESC);

-- CreateIndex
CREATE INDEX "photos_user_id_order_index_idx" ON "photos"("user_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "photos_user_id_order_index_key" ON "photos"("user_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "interests_name_key" ON "interests"("name");

-- CreateIndex
CREATE INDEX "user_interests_user_id_idx" ON "user_interests"("user_id");

-- CreateIndex
CREATE INDEX "locations_user_id_recorded_at_idx" ON "locations"("user_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "locations_geohash_idx" ON "locations"("geohash");

-- CreateIndex
CREATE INDEX "locations_expires_at_idx" ON "locations"("expires_at");

-- CreateIndex
CREATE INDEX "locations_city_idx" ON "locations"("city");

-- CreateIndex
CREATE INDEX "pois_category_idx" ON "pois"("category");

-- CreateIndex
CREATE INDEX "pois_city_category_idx" ON "pois"("city", "category");

-- CreateIndex
CREATE INDEX "pois_is_partner_idx" ON "pois"("is_partner");

-- CreateIndex
CREATE UNIQUE INDEX "pois_source_external_id_key" ON "pois"("source", "external_id");

-- CreateIndex
CREATE INDEX "pois_checkins_user_id_checkin_at_idx" ON "pois_checkins"("user_id", "checkin_at" DESC);

-- CreateIndex
CREATE INDEX "pois_checkins_poi_id_checkin_at_idx" ON "pois_checkins"("poi_id", "checkin_at" DESC);

-- CreateIndex
CREATE INDEX "likes_liker_id_created_at_idx" ON "likes"("liker_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "likes_liked_id_created_at_idx" ON "likes"("liked_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "likes_liker_id_liked_id_key" ON "likes"("liker_id", "liked_id");

-- CreateIndex
CREATE INDEX "matches_user_a_id_matched_at_idx" ON "matches"("user_a_id", "matched_at" DESC);

-- CreateIndex
CREATE INDEX "matches_user_b_id_matched_at_idx" ON "matches"("user_b_id", "matched_at" DESC);

-- CreateIndex
CREATE INDEX "matches_status_idx" ON "matches"("status");

-- CreateIndex
CREATE INDEX "matches_chat_expires_at_idx" ON "matches"("chat_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_a_id_user_b_id_key" ON "matches"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "messages_match_id_created_at_idx" ON "messages"("match_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "visits_visitor_id_visited_at_idx" ON "visits"("visitor_id", "visited_at" DESC);

-- CreateIndex
CREATE INDEX "visits_visited_id_visited_at_idx" ON "visits"("visited_id", "visited_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "visits_visitor_id_visited_id_visited_at_key" ON "visits"("visitor_id", "visited_id", "visited_at");

-- CreateIndex
CREATE INDEX "seals_user_id_idx" ON "seals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "seals_user_id_seal_type_key" ON "seals"("user_id", "seal_type");

-- CreateIndex
CREATE INDEX "blocks_blocker_id_idx" ON "blocks"("blocker_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_expires_at_idx" ON "subscriptions"("user_id", "expires_at" DESC);

-- CreateIndex
CREATE INDEX "boosts_expires_at_idx" ON "boosts"("expires_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_sent_at_idx" ON "notifications"("user_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_platform_token_key" ON "device_tokens"("platform", "token");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "pois"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pois_checkins" ADD CONSTRAINT "pois_checkins_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pois_checkins" ADD CONSTRAINT "pois_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_liked_id_fkey" FOREIGN KEY ("liked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_liker_id_fkey" FOREIGN KEY ("liker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "pois"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visited_id_fkey" FOREIGN KEY ("visited_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seals" ADD CONSTRAINT "seals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosts" ADD CONSTRAINT "boosts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

