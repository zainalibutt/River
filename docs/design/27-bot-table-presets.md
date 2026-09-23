# Bot table preset contract

River now exposes the first player-facing bot setup without revealing which named character is strong or weak.

## Player choices

The Play flow creates a fresh nine-player-seat table with one of two opponent modes:

- Bots requests up to seven seats, leaving the first human a seat and usually one more open for a friend.
- People only creates a table where bots never take an empty seat.

Bot tables offer Casual, Mixed, Tough and Random strength. Random is selected by default. Casual draws only Rookie and Novice personalities. Tough draws only OG and Novice personalities. Mixed guarantees representation from all three skill tiers. Random draws from the complete authored cast. Every cast remains deterministic for its room, uses ordinary names and contains no duplicate personality.

These are table compositions, not a public label attached to a person. A player can know they selected a tough table without being told which named opponent is the strongest.

## Authority and lifetime

The client sends bot seat count and strength only while creating a room. The server validates the values, stores them on that room and returns them in snapshots. A later joiner cannot change an existing table by supplying different setup values. Bot seating still happens when the first hand is dealt, preserving empty chairs for humans until play begins.

The server caps the requested bot count at seven. The room's actual seat count and occupied human seats remain the final limit.

## Profanity preference

Settings includes a per-browser Censor profanity toggle. It defaults to off and masks supported whole words only while rendering table chat. The original server event remains unchanged, so one player's preference does not rewrite another player's conversation or bot dialogue.

## Acceptance gates

- Casual never selects an OG and Tough never selects a Rookie.
- Mixed contains Rookie, Novice and OG personalities.
- A seven-bot cast has seven unique ordinary identities.
- Invalid seat counts and unknown strength values are rejected at the wire boundary.
- Room creation settings survive snapshots and joiners cannot replace them.
- Explicit new-table navigation does not reopen a remembered table.
- Profanity filtering defaults off, persists either choice and fails open if browser storage is unavailable.
- Chrome shows the setup and settings panels in the existing club visual language.
