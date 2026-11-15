// The JTracker icon system (JTracker Icon System v1): a 24 px grid with 2 px
// padding, a 2 px round stroke, app-icon corner radii, and at most one filled
// "destination" dot per icon. The dot is violet on light and mint on dark
// (var(--jt-icon-dot)); in navigation it stays the text colour until the item
// is active. Utility glyphs (archive, theme) have no dot, so the dot keeps its
// meaning. Path data: ./glyphs.ts.

import React from 'react';

import { GLYPHS, type Glyph, type GlyphName } from './glyphs';

export interface JTrackerIconProps {
  size?: number;
  className?: string;
  // 'accent': the dot takes the theme accent (violet / mint). 'quiet': the
  // text colour, as in navigation until the item is active.
  dot?: 'accent' | 'quiet';
  // Accessible name; without one the icon is decorative.
  title?: string;
}

export type JTrackerIcon = React.FC<JTrackerIconProps>;

export const JIcon: React.FC<JTrackerIconProps & { glyph: GlyphName }> = ({
  glyph,
  size = 20,
  className = '',
  dot = 'accent',
  title,
}) => {
  const { d, dot: point } = GLYPHS[glyph] as Glyph;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-icon={glyph}
    >
      <path d={d} />
      {point && (
        <circle cx={point[0]} cy={point[1]} r={point[2]} fill={dot === 'accent' ? 'var(--jt-icon-dot)' : 'currentColor'} stroke="none" />
      )}
    </svg>
  );
};

export const DashboardIcon: JTrackerIcon = (props) => <JIcon glyph="Dashboard" {...props} />;
export const ApplicationsIcon: JTrackerIcon = (props) => <JIcon glyph="Applications" {...props} />;
export const BoardIcon: JTrackerIcon = (props) => <JIcon glyph="Board" {...props} />;
export const SearchIcon: JTrackerIcon = (props) => <JIcon glyph="Search" {...props} />;
export const AnalyticsIcon: JTrackerIcon = (props) => <JIcon glyph="Analytics" {...props} />;
export const InterviewsIcon: JTrackerIcon = (props) => <JIcon glyph="Interviews" {...props} />;
export const OffersIcon: JTrackerIcon = (props) => <JIcon glyph="Offers" {...props} />;
export const InboxIcon: JTrackerIcon = (props) => <JIcon glyph="Inbox" {...props} />;
export const ResumeIcon: JTrackerIcon = (props) => <JIcon glyph="Resume" {...props} />;
export const NotificationsIcon: JTrackerIcon = (props) => <JIcon glyph="Notifications" {...props} />;
export const AssistantIcon: JTrackerIcon = (props) => <JIcon glyph="Assistant" {...props} />;
export const SettingsIcon: JTrackerIcon = (props) => <JIcon glyph="Settings" {...props} />;
export const HiredIcon: JTrackerIcon = (props) => <JIcon glyph="Hired" {...props} />;
export const PendingIcon: JTrackerIcon = (props) => <JIcon glyph="Pending" {...props} />;
export const SuccessIcon: JTrackerIcon = (props) => <JIcon glyph="Success" {...props} />;
export const RejectedIcon: JTrackerIcon = (props) => <JIcon glyph="Rejected" {...props} />;
export const ImportIcon: JTrackerIcon = (props) => <JIcon glyph="Import" {...props} />;
export const ExportIcon: JTrackerIcon = (props) => <JIcon glyph="Export" {...props} />;
export const EmailIcon: JTrackerIcon = (props) => <JIcon glyph="Email" {...props} />;
export const ProfileIcon: JTrackerIcon = (props) => <JIcon glyph="Profile" {...props} />;
export const FollowUpsIcon: JTrackerIcon = (props) => <JIcon glyph="FollowUps" {...props} />;
export const CvTrackingIcon: JTrackerIcon = (props) => <JIcon glyph="CvTracking" {...props} />;
export const RecruitersIcon: JTrackerIcon = (props) => <JIcon glyph="Recruiters" {...props} />;
export const CompaniesIcon: JTrackerIcon = (props) => <JIcon glyph="Companies" {...props} />;
export const ShareIcon: JTrackerIcon = (props) => <JIcon glyph="Share" {...props} />;
export const ArchiveIcon: JTrackerIcon = (props) => <JIcon glyph="Archive" {...props} />;
export const SunIcon: JTrackerIcon = (props) => <JIcon glyph="Sun" {...props} />;
export const MoonIcon: JTrackerIcon = (props) => <JIcon glyph="Moon" {...props} />;
export const SystemThemeIcon: JTrackerIcon = (props) => <JIcon glyph="SystemTheme" {...props} />;

// ── Logo: The Tick ───────────────────────────────────────────────────────────
// A lowercase j that is also a tick; its dot is the destination, the offer.
// The tile is navy on light backgrounds and violet on dark ones.
export const JTrackerLogo: React.FC<{
  size?: number;
  className?: string;
  title?: string;
  // 'violet' for a background that is already navy in both themes.
  tile?: 'auto' | 'violet';
}> = ({ size = 32, className = '', title, tile = 'auto' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    className={className}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
  >
    <rect width="64" height="64" rx="18" className={tile === 'violet' ? 'fill-[#7768F6]' : 'fill-[#202D64] dark:fill-[#7768F6]'} />
    <path d="M17 32v5c0 6 4 10 10 10c5 0 8-3 10-8l6.5-16" fill="none" stroke="#F9FAFF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="47.6" cy="13.2" r="4.6" fill="#6AF0C2" />
  </svg>
);
