// Gaming College's own internal dashboard (view === "dashboard").
// Extracted out of App.jsx once this view grew a real hero section —
// see the plan notes for the redesign this came out of. Every widget
// here is backed by a real Lykodex data source (see each card
// component's own header comment for where its data comes from); no
// invented ranks/reputation/missions/combat stats.

import ProfileHeading from "./ProfileHeading";
import SteamPresenceCard from "./SteamPresenceCard";
import GamingPresenceCard from "./GamingPresenceCard";
import CurrentRotation from "./CurrentRotation";
import GuildSocialCard from "./GuildSocialCard";
import ReleaseCalendarCard from "./ReleaseCalendarCard";
import HorizontalLane from "./mobile/HorizontalLane";

export default function GamingDashboard({
  isLoggedIn, avatarUrl, firstName, lastName, username,
  masteryScore, masteryLevel, masteryBreakdown, wishlist, linkedSteamId, userId,
  customizingLayout: _customizingLayout,
  dashboardLayout: _dashboardLayout,
  setDashboardLayout: _setDashboardLayout,
  gridWidth: _gridWidth,
  gridContainerRef: _gridContainerRef,
  goTo, profileDetails, onRecomputeMastery,
}) {
  return (
    <>
      <ProfileHeading
        isLoggedIn={isLoggedIn}
        avatarUrl={avatarUrl}
        firstName={firstName}
        lastName={lastName}
        username={username}
        masteryScore={masteryScore}
        masteryLevel={masteryLevel}
        masteryBreakdown={masteryBreakdown}
        userId={userId}
        linkedSteamId={linkedSteamId}
        onGoToSettings={() => goTo("settings")}
        onGoToLinking={() => goTo("linking")}
        onRecomputeMastery={onRecomputeMastery}
        profileDetails={profileDetails}
      />

      <HorizontalLane label="Right now">
        {isLoggedIn && <SteamPresenceCard userId={userId} linkedSteamId={linkedSteamId} />}
        {isLoggedIn && <GamingPresenceCard userId={userId} />}
        <CurrentRotation
          wishlist={wishlist}
          linkedSteamId={linkedSteamId}
          userId={userId}
          onOpenBacklog={() => goTo("backlog")}
          onOpenPrices={() => goTo("prices")}
          onOpenLibrary={() => goTo("library")}
        />
        <GuildSocialCard
          isLoggedIn={isLoggedIn}
          userId={userId}
          onOpenGuilds={() => goTo("guilds")}
        />
      </HorizontalLane>

      {/* Personal row — your own progress, at a glance */}
      <HorizontalLane label="Your progress" className="gaming-hero-grid">
        <ReleaseCalendarCard wishlist={wishlist} linkedSteamId={linkedSteamId} onOpenCalendar={() => goTo("release-calendar")} />
      </HorizontalLane>
    </>
  );
}
