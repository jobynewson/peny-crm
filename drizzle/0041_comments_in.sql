-- 0041_comments_in.sql
-- A third answer to a round: "Comments are in" — the client has finished leaving
-- feedback in Frame.io and it is over to us. Not approval, not a rejection, and
-- not changes_requested (which carries its comment in Slate). delivery_response
-- gets the answer; deliverable_status gets the state it leaves the deliverable
-- in, so "feedback is complete" stays distinguishable from "still arriving".
-- Also applied by runMigrations() in src/db/client.js.

ALTER TYPE delivery_response ADD VALUE IF NOT EXISTS 'comments_in';
ALTER TYPE deliverable_status ADD VALUE IF NOT EXISTS 'comments_in';
