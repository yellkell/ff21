# FF2 menu research and first iteration

Research date: 22 September 2026. Scope: the main FF2 lobby, its existing modes, customization, social doors and supporting panels. Rave Raid's internal song/tour menus are a separate navigation layer.

## Finding

FF2 needs a clearer classification system before another visual reskin. A player should be able to predict where an action lives from its name. The existing `ARCADE` category mixes learning, solo progression, cooperative combat and an entirely different rhythm game. `YOU` combines painting, equipment and currency purchases. `CLUB` consumes a primary tab for a single door, while `TOWN` is actually a population dashboard.

The first implementation groups by intent at the top level, then by game family inside Play. It preserves the current VR panels, pointer interaction, onboarding and gameplay systems. This is an information-architecture iteration, not an imitation of another game's visual skin.

## Evidence and what it means for FF2

These are developer-published descriptions and documentation, not hands-on tests of the current commercial clients. Dates distinguish historical design decisions from newer announcements. A published design intention is not proof that players find the resulting interface easier. No population-wide conclusions are drawn from forum sentiment.

### Overwatch: identity, play, social context and consolidated updates

Blizzard's 2026 Spotlight describes changes to the lobby, play cards, navigation, hero gallery and social panel. It describes a notification hub and a 3D lobby centered on the selected hero; expansion to the group is described as a Season 4 plan. It also explicitly acknowledges that moving Play requires players to relearn its position. This establishes the design direction, not independent confirmation that every announced feature shipped unchanged.

**Application:** retain the fighter/profile as the identity anchor; keep Play in a stable central position; give social actions an explicit home; preserve one News destination and meaningful unread indication. Avoid adding a promotional carousel just because a larger game has one. FF2 already has a world and character worth showing.

Source: [Blizzard, Overwatch Spotlight: The Reign of Talon Begins, 2026](https://news.blizzard.com/en-us/article/24246206/overwatch-spotlight-the-reign-of-talon-begins), UI/UX Refresh section and accompanying menu image.

### Fortnite: stable navigation across different experiences

Epic's October 2023 custom-lobby announcement separates an experience's lobby/background from the navigation shared across experiences. Its Discover documentation distinguishes browsing, selecting an experience, choosing public/private access, and starting play; Library holds favorites and recently played items.

**Application:** distinguish Versus, Titans and Rave Raid within Play. Keep personal equipment, news and settings available in the same physical locations as the selected family changes. A family selection should not launch gameplay or unexpectedly change venue. Remember the selected family when visiting Practice and returning. Favorites and recent activities are sensible later additions if FF2's catalogue grows; there are too few families to justify them now.

Sources: [Epic, Introducing Custom Lobbies, 10 October 2023](https://www.fortnite.com/news/introducing-custom-lobbies-for-games-in-fortnite); [Epic, Exploring Discover](https://dev.epicgames.com/documentation/fortnite/exploring-discover-in-fortnite-creative).

### VALORANT: predictable navigation and clear ownership

Riot's 2020 patches document moving Find Match and Practice out of the social panel into Play, making navigation targets easier to click, and standardizing Back across main and detail screens. They also separate player-facing agent progression from the broader Collection area when it becomes substantial enough to deserve a home. These are historical rationale examples, not a claim about the exact 2026 menu.

**Application:** use one owning route for each launch flow. The Social private-game shortcut leads into the same Versus room setup, not a second implementation. Keep room cancellation visible and prevent switching to a different activity while a room/search is pending. Make Store directly reachable without opening the equipment modal first. Preserve explicit names rather than relying on icons or hover to explain a destination.

Sources: [Riot, VALORANT 0.49, 29 April 2020](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-0-49/); [Riot, VALORANT 1.02, 23 June 2020](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-02/).

### Destiny 2: progression has a coherent home

Bungie's Lightfall update describes renaming Triumphs to Journey, adding direct access from Orbit, and moving detailed Triumphs and Titles into their own subordinate screens to focus the top level. Progression becomes a recognizable destination rather than a collection of unrelated links.

**Application:** expose FF2's existing Career Profile clearly, alongside its persistent identity chip. Use it for rank, XP and achievements. Do not invent a Battle Pass or Challenges tab: this project does not currently have the corresponding content and reward lifecycle. A dedicated Career panel can follow if the existing record grows beyond the profile card.

Source: [Bungie, Destiny 2 Update 7.0.0.1, 28 February 2023](https://www.bungie.net/7/en/News/Article/update_7_0_0_1), UI/UX section.

### Recognition and VR constraints

Nielsen Norman Group explains why visible, recognizable choices reduce memory demands compared with recalling hidden commands. This supports replacing broad labels such as Arcade with descriptive destinations and adding short scope explanations where they resolve ambiguity.

Meta's spatial UI guidance recommends generous targets, spacing and matching input to distance. Ray interaction is appropriate for panels beyond comfortable reach. It cautions against dense controls and controls that change as the pointer approaches. FF2 uses controller rays; hand-tracking-specific thresholds are useful reference points, not a claim of controller certification.

**Application:** retain large cards, fixed locations and visible text. Do not squeeze a desktop navigation bar across the whole surrounding room. Keep one extra family row on the central panel, no scrolling to find a game family, and no hover-only submenus. The existing side panels remain a tradeoff: convenient simultaneous access versus head movement. This pass does not claim to have solved or measured that ergonomic tradeoff.

Sources: [NN/g, Memory Recognition and Recall, 15 January 2024](https://www.nngroup.com/articles/recognition-and-recall/); [Meta, Hands UI Best Practices](https://developers.meta.com/horizon/design/hands-ui-best-practices/).

## Applied navigation

| Area | Destination | Contents and reason |
| --- | --- | --- |
| Center | Play / Versus | Quick Match, Ranked, Custom Games, 2v2, Free for All. Mode cards share equal dimensions and aligned rows; Bots Only remains a smaller preference control. Bots-only explains its quick-match and team-battle scope; Ranked shows why it is unavailable. |
| Center | Play / Titans | Campaign and co-op raid. Both are boss activities; distinguish a solo campaign from forming a squad. Bots-only disables online raids and offers the same preference toggle here so the player can resolve the restriction locally. |
| Center | Play / Rave Raid | Entry to the rhythm game's tour, solo and multiplayer menus. No ambiguity with the titan raid. |
| Center | Practice | Tutorial and Aim Training. Shoot Back sits beside the activity it modifies and says that it affects aim training only. |
| Center | Social | Enter Club; Custom Games shortcut to shared private-room setup. This is about gathering, not a second mode catalogue. |
| Left | Activity | Live queue, forming squads and club population. The name describes what is actually on this panel. |
| Left | Rankings | Existing battle, XP and arcade scoreboards. News and rankings remain supporting information rather than interruptions before play. |
| Left | News | Gazette and its larger reader; existing unread behavior retained. |
| Right | Locker | Owned gear/loadout, Paint Studio and Career Profile. Equipping is distinct from buying. |
| Right | Store | Browse cosmetics, Bank and current balance. Account/purchase recovery stays beside the bank. |
| Right | Settings | Existing audio, voice, paint visibility, reports and credits. |
| Above right | Identity chip | Persistent access to the existing profile and identity controls. |

The current left panel continues to open on News. Changing that default without knowing how players use the Gazette would mix two experiments. Play still opens on Versus, and Quick Match remains one press away after onboarding. Following visual review, static descriptive footers were removed from the landing pages and custom-game setup; actionable status and control-specific explanations remain.

## Flow comparison

Counts begin from the default, tutorial-complete lobby and count menu presses up to opening the relevant destination, not gameplay loading or further choices inside it.

| Task | Before | First iteration |
| --- | --- | --- |
| Quick match | Quick Match: 1 | Quick Match: 1 |
| Aim training | Arcade, Aim Training: 2 | Practice, Aim Training: 2 |
| Campaign | Arcade, Campaign: 2 | Titans, Campaign: 2 |
| Rave Raid | Arcade, Rave Raid: 2 | Rave Raid family, Enter: 2 |
| Club | Club, Enter: 2 | Social, Enter Club: 2 |
| Browse cosmetics | Customization, Store: 2 | Store, Browse Cosmetics: 2 |
| Buy currency | Wallet: 1 | Store, Bank: 2 |

The currency path deliberately gains one press so shopping no longer occupies the personal equipment landing. These counts are a code-path analysis, not measured completion times. The expected improvement is predictability and scope clarity, not a universal reduction in clicks.

## Second iteration: the Quest board (24 October 2026)

The native Meta Quest build iterated on this lobby on a headset, and its board comes back here (`menu/board.ts`, `menu/playPage.ts`, `menu/wrap.ts`). The three panels became ONE BOARD dead ahead in RAVE RAID's format, in FIRE FIGHT's colours: the sheared FIRE FIGHT 2 wordmark, a status chip, the settings cog and THE PROFILE chip in the header, an indexed rail down the left with a sliding marker, and the open page in the content region beside it.

| Rail | Destination | Contents and reason |
| --- | --- | --- |
| 01 | Career | Takes the whole board: ‹ BACK and CAMPAIGN in the header, the campaign under it. |
| 02 | Versus | The PLAY page: a SELECT MODE list (Quick Match, Ranked, Custom Games, 2v2, Free for All, Co-op Raid, Aim Training, Tutorial), a plate with only real data, one CTA. Shoot Back sits on Aim Training's plate. The board opens here. |
| 03 | Rave Raid | A door: one press walks into the foyer. |
| 04 | Club | A door: one press knocks, and the page reads out the wait while the house wakes. |
| 05 | Rankings | The ladder, unchanged, in the content region. |
| 06 | News | The paper, plus a standing NOW AVAILABLE ON THE META QUEST STORE strap over every edition. |
| 07 | Locker | A door onto the customization plate. |
| 08 | Store | A door onto the catalogue. |
| cog | Settings | In the header, not on the rail. |

Activity left the board. Its three counts ride the places they describe: the queue on Quick Match's plate, forming squads on Co-op Raid's, the club's head count under CLUB on the rail. The menus never say "bots": the opponent while a quick match searches is a rival, the lobby's no-wait button is FIGHT NOW, the bout panel is THE BOUT.

| Task | First iteration | Quest board |
| --- | --- | --- |
| Quick match | Versus family, Quick Match: 2 | Fight: 1 (Quick Match is the selected mode) |
| Aim training | Practice, Aim Training: 2 | Aim Training, Start: 2 |
| Campaign | already up: 0 | Career: 1 |
| Rave Raid | Rave Raid family, Enter: 2 | Rave Raid: 1 |
| Club | Social, Enter Club: 2 | Club: 1 |
| Co-op raid | Rave Raid family, Co-op Raid: 2 | Co-op Raid, Form a Squad: 2 |
| Browse cosmetics | Store, Browse Cosmetics: 2 | Store: 1 |

The ROOMS page (`menu/roomPage.ts`) is a board page too: the arcade lobby (the room browser and the squad room for 2v2, FFA and the co-op raid) and the CUSTOM GAMES / RANKED screens are laid out in the PLAY page's format where VERSUS sits, with ‹ BACK / LEAVE bottom-left and the rail still up — no floating modal. The web keeps the invite QR, the join link and SHARE ON DISCORD in the squad room's invite band.

THE CLUB MENU (right Ⓐ on the club floor, `rave/club/clubMenu.ts`) is the same board in the club's own colours: 01 THE ROOM (everyone on the floor, MUTE / BLOCK), 02 DISCO BALL (the old THE BELL: FIGHT or RAVE, the tier list and the record list inline, one CTA), 03 SOUND (mic, voice chat, music), 04 LEAVE.

Still to come back from the Quest build: CAREER and CUSTOMIZE as redesigned full pages, the RANKINGS redesign and the BELTS row on the card. The board hosts the web's own faces for those meanwhile.

## Validation and next iteration

The wrap smoke test (`tools/wrap-check.mjs`, now walking the board) covers fresh-save onboarding, every rail page and door, return to the remembered family, Club entry/return, private-room navigation, direct Store entry and return, and the existing settings, equipment, paint, news and profile flows. Canvas captures should be checked for readable copy, tab separation and action hierarchy. Typecheck/build verify integration.

Next, test with a headset and a few players unfamiliar with the new grouping. Ask them to find a co-op boss fight, practice with return fire, equip owned gear, buy a cosmetic, inspect their record and meet a friend. Record first tab selected, wrong turns, completion time and whether they can explain the categories afterward. These are proposed evaluation measures; no usability improvement percentage is claimed.

Possible second iterations depend on the results: make Activity actionable, give Career its own full panel, add a recent-activity shortcut, or consolidate supporting panels to reduce head movement. Keep the current mode labels and visual language stable while testing the category change so results are interpretable.
