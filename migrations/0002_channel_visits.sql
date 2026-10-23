-- Visits through /go/<channel> links, per channel per day. Counts only; nothing about the visitor.
CREATE TABLE channel_visits (
  channel TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (channel, day)
);
