import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePublicOperationAlert, usePublicStatusSummary } from "../hooks/useEvacuationQueries";
import { getLandingText, landingLocaleOptions } from "../locales/landing";
import { emergencyContacts } from "../config/emergencyContacts";
import { formatManilaTime } from "../utils/dateTime";
import "./LandingPage.css";
import "./LandingPage.motion.css";
import { LoginDialog, ResidentSignUpDialog } from "../components/AuthModals/AuthModals"; // must come after LandingPage.css

const MAP_KEY = ["closed", "center", "route"];
const STEPS = ["locate", "hazards", "route"];
const mdrrmoHotlines = emergencyContacts.hotlines.filter((item) => item.label === "MDRRMO/SERT");

function Logo() {
  return (
    <Link
      to="/"
      className="ew-logo"
      aria-label="EvacWay - Municipal Disaster Risk Reduction and Management Office"
    >
      <img src="/evacway-logo-text.png" alt="EvacWay" className="ew-logo-image" />
      <span className="ew-brand-divider" aria-hidden="true" />
      <div className="ew-lgu-partner">
        <img src="/mdrrmo-logo.png" alt="MDRRMO Sogod Logo" className="ew-lgu-logo ew-mdrrmo-logo" />
        <span className="ew-lgu-name">Municipal Disaster Risk Reduction and Management Office</span>
      </div>
    </Link>
  );
}

/**
 * Stepped Topographic Relief & Route Map matching the target reference design.
 * Features perspective graticule lines, multi-layer stepped coastal elevation contours,
 * orange hatched landslide zone, teal/amber hatched flood-prone basin, red dashed closed road,
 * concentric "YOU ARE HERE" radar node, glowing blue safe route, aqua-glowing "EVACUATION CENTER" pin,
 * and notched callout tags ("FLOOD RISK: HIGH", "ROAD CLOSED AHEAD", "ROUTE FOUND").
 */
function MapArt({ preserveAspectRatio = "xMidYMid slice" }) {
  const routeD = "M598 634L1218 456";

  return (
    <svg
      className="ew-mapart"
      viewBox="0 0 1440 860"
      preserveAspectRatio={preserveAspectRatio}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ew-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F5F9FF" />
          <stop offset="55%" stopColor="#ECF3FC" />
          <stop offset="100%" stopColor="#DFEBFA" />
        </linearGradient>

        <linearGradient id="ew-land-step-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#DCE8F7" />
          <stop offset="100%" stopColor="#C9DBF0" />
        </linearGradient>

        <linearGradient id="ew-land-step-2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E4EEF9" />
          <stop offset="100%" stopColor="#D3E2F4" />
        </linearGradient>

        <linearGradient id="ew-land-step-3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ECF3FB" />
          <stop offset="100%" stopColor="#DCE9F7" />
        </linearGradient>

        <linearGradient id="ew-route-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1D5ED8" />
          <stop offset="65%" stopColor="#2B7FFF" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        <filter id="ew-land-shadow" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#7B99C4" floodOpacity="0.22" />
        </filter>

        <filter id="ew-route-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#2563EB" floodOpacity="0.55" />
        </filter>

        <filter id="ew-center-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor="#10B981" floodOpacity="0.55" />
          <feDropShadow dx="0" dy="0" stdDeviation="20" floodColor="#38BDF8" floodOpacity="0.45" />
        </filter>

        <filter id="ew-tag-shadow" x="-15%" y="-20%" width="130%" height="150%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0D203B" floodOpacity="0.1" />
        </filter>

        <path id="ew-route-path" d={routeD} />
      </defs>

      {/* Base ice-blue paper canvas */}
      <rect width="1440" height="860" fill="url(#ew-bg-grad)" className="m-land" />

      {/* Perspective Graticule Grid in the Bay / Upper Canvas */}
      <g className="ew-graticule-group" opacity="0.55">
        <path
          d="M0 180H1440 M0 250H1440 M0 320H1440 M0 390H1440 M0 460H1440 M0 530H1440 M0 600H1440 M0 670H1440 M0 740H1440"
          stroke="#DCE7F5"
          strokeWidth="1"
        />
        <path
          d="M140 120L40 860 M280 120L210 860 M420 120L380 860 M560 120L550 860 M700 120L720 860 M840 120L890 860 M980 120L1060 860 M1120 120L1230 860 M1260 120L1400 860"
          stroke="#DCE7F5"
          strokeWidth="1"
        />
        {/* Dashed Bathymetric / Shipping Arc */}
        <path
          d="M880 390C1040 315 1230 255 1440 218"
          fill="none"
          stroke="#9BB3D1"
          strokeWidth="1.4"
          strokeDasharray="4 6"
        />
      </g>

      {/* ==========================================================================
         BOTTOM-LEFT STEPPED TOPOGRAPHIC CONTOURS
         ========================================================================== */}
      <g className="ew-topo-left">
        <path
          d="M0 445C28 452 44 488 32 528C20 568 58 584 82 558C106 532 138 548 128 594C118 640 156 648 192 612C228 576 286 588 278 642C270 696 322 708 368 682C414 656 462 692 438 748C414 804 456 832 488 860H0Z"
          fill="url(#ew-land-step-2)"
          stroke="#B4C8E2"
          strokeWidth="1.2"
          filter="url(#ew-land-shadow)"
        />
        <path
          d="M0 488C20 496 30 532 22 566C14 600 54 612 78 590C102 568 126 588 116 628C106 668 148 676 184 644C220 612 268 624 260 672C252 720 306 734 348 712C390 690 432 720 410 770C388 820 422 842 446 860H0Z"
          fill="url(#ew-land-step-3)"
          stroke="#BCCEE6"
          strokeWidth="1.1"
        />
        <path
          d="M0 540C24 562 54 634 94 654C134 674 176 646 216 672C256 698 242 752 288 764C334 776 376 742 392 792C404 828 392 848 404 860H0Z"
          fill="none"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        <path
          d="M0 610C32 632 58 692 98 708C138 724 182 698 214 728C246 758 232 806 274 822C316 838 348 818 362 860"
          fill="none"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        <path
          d="M0 688C36 710 68 756 112 768C156 780 192 764 218 804C244 844 236 854 252 860"
          fill="none"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        {/* Subtle sunken contour loop around (368, 742) */}
        <ellipse cx="368" cy="742" rx="28" ry="42" fill="rgba(180, 204, 234, 0.25)" stroke="#B8CBE3" strokeWidth="1" />
        <ellipse cx="368" cy="742" rx="16" ry="25" fill="rgba(160, 190, 228, 0.28)" stroke="#ADC3E0" strokeWidth="1" />
        <circle cx="368" cy="742" r="3.5" fill="#3B69B8" />
      </g>

      {/* ==========================================================================
         RIGHT & LOWER-RIGHT STEPPED COASTAL HEADLAND TOPOGRAPHY
         ========================================================================== */}
      <g className="ew-topo-right">
        {/* Outer Coastal Shelf (Step 1) */}
        <path
          d="M826 202C865 196 935 194 982 204C1030 214 1095 190 1165 190C1255 190 1350 184 1440 182V860H742C728 836 748 814 724 796C700 778 656 792 642 770C628 748 668 734 654 716C640 698 584 712 562 696C540 680 582 666 568 652C554 638 548 622 578 608C608 594 648 586 678 564C708 542 746 534 788 516C830 498 886 488 924 468C962 448 996 426 1018 404C1040 382 968 372 952 356C936 340 984 328 966 312C948 296 904 304 892 288C880 272 932 264 918 248C904 232 848 240 838 226C828 212 806 206 826 202Z"
          fill="url(#ew-land-step-1)"
          stroke="#9FB7D6"
          strokeWidth="1.4"
          filter="url(#ew-land-shadow)"
        />

        {/* Stepped Elevation Layer 2 */}
        <path
          d="M868 214C915 208 975 212 1035 204C1110 194 1240 196 1440 194V860H768C756 838 772 816 748 798C724 780 682 790 668 768C654 746 692 732 678 712C664 692 612 704 596 686C580 668 618 654 612 636C606 618 644 602 686 582C728 562 778 546 828 524C878 502 934 486 978 460C1022 434 1062 406 1044 384C1026 362 984 364 974 346C964 328 1008 316 992 298C976 280 928 288 918 272C908 256 954 248 938 232C922 216 852 220 868 214Z"
          fill="url(#ew-land-step-2)"
          stroke="#ACC2DF"
          strokeWidth="1.2"
        />

        {/* Stepped Elevation Layer 3 */}
        <path
          d="M920 228C980 222 1060 214 1160 210C1260 206 1350 206 1440 206V860H796C784 834 794 808 770 788C746 768 708 776 696 752C684 728 718 714 704 692C690 670 648 678 642 654C636 630 688 608 738 586C788 564 848 542 904 514C960 486 1022 456 1068 422C1104 396 1054 374 1024 356C994 338 1034 318 1018 298C1002 278 958 282 948 264C938 246 968 234 920 228Z"
          fill="url(#ew-land-step-3)"
          stroke="#B6CAE4"
          strokeWidth="1.15"
        />

        {/* Nested Inner Topographic Contour Rings (Layers 4 to 10) */}
        <path
          d="M985 244C1080 232 1240 224 1440 222M1440 840C1340 830 1240 838 1160 818C1080 798 1020 824 940 808C860 792 824 756 782 728C740 700 688 682 704 648C720 614 804 584 878 552C952 520 1038 482 1102 436C1150 402 1094 372 1068 350C1042 328 1072 302 1044 278C1016 254 960 250 985 244"
          fill="none"
          stroke="#B8CCE5"
          strokeWidth="1.1"
        />
        <path
          d="M1040 262C1140 248 1280 240 1440 238M1440 805C1340 792 1250 804 1175 782C1100 760 1035 788 965 768C895 748 852 712 808 686C764 660 738 638 768 608C798 578 882 548 958 512C1034 476 1118 432 1158 392C1186 364 1128 338 1104 314C1080 290 1092 270 1040 262"
          fill="none"
          stroke="#BDCEE6"
          strokeWidth="1.05"
        />
        <path
          d="M1095 282C1195 268 1310 258 1440 256M1440 768C1350 756 1265 768 1195 744C1125 720 1060 748 995 728C930 708 885 674 845 648C805 622 812 594 868 566C924 538 1012 502 1088 458C1164 414 1218 372 1188 338C1158 304 1125 292 1095 282"
          fill="none"
          stroke="#C2D2E8"
          strokeWidth="1"
        />
        <path
          d="M1155 304C1250 288 1345 278 1440 276M1440 726C1355 714 1280 726 1215 702C1150 678 1090 704 1030 684C970 664 920 632 908 600C896 568 968 536 1048 496C1128 456 1228 408 1248 364C1268 320 1195 312 1155 304"
          fill="none"
          stroke="#C6D5EA"
          strokeWidth="1"
        />
        {/* Sculpted Highland Ridge Loops on Lower-Right */}
        <path
          d="M960 720C990 692 1065 696 1110 724C1155 752 1140 808 1085 824C1030 840 945 812 938 772C931 732 945 734 960 720Z"
          fill="rgba(210, 226, 246, 0.35)"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        <path
          d="M992 738C1018 718 1072 722 1098 744C1124 766 1112 802 1072 812C1032 822 978 800 974 772C970 744 978 748 992 738Z"
          fill="none"
          stroke="#C0D1E7"
          strokeWidth="1"
        />
        <path
          d="M1190 610C1235 582 1320 588 1375 624C1430 660 1410 735 1345 755C1280 775 1185 738 1170 688C1155 638 1165 626 1190 610Z"
          fill="rgba(210, 226, 246, 0.3)"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        <path
          d="M1225 634C1260 612 1325 618 1360 646C1395 674 1380 726 1330 740C1280 754 1212 724 1202 686C1192 648 1205 646 1225 634Z"
          fill="none"
          stroke="#C2D2E8"
          strokeWidth="1"
        />
      </g>

      {/* ==========================================================================
         ROADS, HAZARD ZONES, SAFE ROUTE & WAYPOINT NODES
         ========================================================================== */}
      <g className="ew-map-foreground">
        {/* Secondary / Approach Grey Road Lines */}
        <g className="ew-roads-layer">
          {/* Bottom-left approach road into YOU ARE HERE */}
          <path
            className="m-road"
            d="M78 860C148 776 208 738 308 700C408 662 496 636 598 634"
          />
          {/* Bypassed lower road through flood & closure, reconnecting up-right */}
          <path
            className="m-road"
            d="M598 634C690 634 785 634 878 630M1072 602C1168 580 1260 556 1348 532L1218 456"
          />
          {/* Continuation road past Evacuation Center to right edge */}
          <path className="m-road" d="M1218 456L1440 412" />
        </g>

        {/* Small Waypoint Nodes on Approach Road & Far-Right Road */}
        <g transform="translate(210 744)">
          <circle r="7" fill="rgba(59, 130, 246, 0.18)" />
          <circle r="3.5" fill="#64748B" />
        </g>
        <g transform="translate(254 720)">
          <circle r="9" fill="rgba(59, 130, 246, 0.25)" />
          <circle r="3.8" fill="#3B82F6" stroke="#FFFFFF" strokeWidth="1.2" />
        </g>
        <g transform="translate(1332 433)">
          <circle className="ew-node-halo" r="14" />
          <circle r="6" fill="#3B82F6" stroke="#FFFFFF" strokeWidth="2" />
        </g>

        {/* CLOSED ROAD: Red Dashed Road + Red Circle X + Red Dashed Leader Line */}
        <g className="m-closed-marker">
          <path
            className="m-closed"
            d="M878 630C946 628 1012 616 1072 602"
          />
          <line
            x1="986"
            y1="566"
            x2="1052"
            y2="606"
            stroke="#DC2626"
            strokeWidth="1.8"
            strokeDasharray="4 4"
          />
          <line
            x1="1040"
            y1="598"
            x2="1066"
            y2="614"
            stroke="#DC2626"
            strokeWidth="1.4"
          />
          <g transform="translate(918 629)">
            <circle r="8.5" className="m-sign" />
            <path className="m-x" d="M-3.2 -3.2L3.2 3.2M3.2 -3.2L-3.2 3.2" />
          </g>
        </g>

        {/* INITIAL DIRECT ROUTE (draws first, fades when road closes) */}
        <path
          className="m-route-initial"
          pathLength="1"
          d="M598 634C720 634 830 628 918 629C1020 618 1120 550 1218 456"
        />

        {/* GLOWING BLUE SAFE DETOUR ROUTE (From YOU ARE HERE to EVACUATION CENTER) */}
        <g className="m-route-detour-wrap">
          <path
            d={routeD}
            fill="none"
            stroke="rgba(37, 99, 235, 0.24)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path className="m-route m-route-detour" pathLength="1" d={routeD} filter="url(#ew-route-glow)" />
        </g>
        <path className="m-flow" pathLength="1" d={routeD} />

        {/* ORIGIN: YOU ARE HERE (Concentric Blue Radar Rings) */}
        <g transform="translate(598 634)">
          <circle r="34" fill="none" stroke="rgba(59, 130, 246, 0.16)" strokeWidth="1.2" />
          <circle r="25" fill="none" stroke="rgba(59, 130, 246, 0.26)" strokeWidth="1.2" />
          <circle className="m-pulse" r="16" />
          <circle r="11" fill="none" stroke="rgba(37, 99, 235, 0.5)" strokeWidth="1.5" />
          <circle className="m-you" r="5.5" />
          <text x="0" y="48" textAnchor="middle" className="m-label">YOU ARE HERE</text>
        </g>

        {/* DESTINATION: EVACUATION CENTER (Aqua-Glowing House Pin) */}
        <g className="m-center-g" transform="translate(1218 456)">
          <text x="0" y="-36" textAnchor="middle" className="m-label">EVACUATION CENTER</text>
          <circle className="m-center-ring" r="24" />
          <circle className="ew-node-halo" r="28" filter="url(#ew-center-glow)" />
          <circle cx="0" cy="0" r="16" className="m-center" />
          <path className="m-house" d="M-6.5 1.2L0 -5L6.5 1.2M-4.5 -0.2V6H4.5V-0.2" />
          <rect x="-1.6" y="2" width="3.2" height="4" fill="#1D58C8" />
        </g>

        {/* ==========================================================================
           CHAMFERED CALLOUT TAGS LOCKED TO EXACT SVG FEATURES
           ========================================================================== */}
        {/* Tag 1: ROAD CLOSED AHEAD */}
        <g className="ew-svg-chip ew-svg-chip-b" transform="translate(890 532)" filter="url(#ew-tag-shadow)">
          <path
            d="M0 6C0 2.7 2.7 0 6 0H168L178 10V28C178 31.3 175.3 34 172 34H6C2.7 34 0 31.3 0 28Z"
            fill="rgba(255, 255, 255, 0.94)"
            stroke="#DCE7F5"
            strokeWidth="1"
          />
          <circle cx="16" cy="17" r="4.2" fill="#DC2626" />
          <text x="28" y="21" className="ew-svg-chip-text">ROAD CLOSED AHEAD</text>
        </g>

        {/* Tag 3: ROUTE FOUND */}
        <g className="ew-svg-chip ew-svg-chip-c" transform="translate(1158 486)" filter="url(#ew-tag-shadow)">
          <path
            d="M0 6C0 2.7 2.7 0 6 0H126L136 10V28C136 31.3 133.3 34 130 34H6C2.7 34 0 31.3 0 28Z"
            fill="rgba(255, 255, 255, 0.94)"
            stroke="#DCE7F5"
            strokeWidth="1"
          />
          <path
            d="M12 17.5L15.5 21L22 13.5"
            fill="none"
            stroke="#10B981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x="29" y="21" className="ew-svg-chip-text">ROUTE FOUND</text>
        </g>
      </g>

      <g className="m-rain" aria-hidden="true" />
    </svg>
  );
}

function MobileRouteCard() {
  const safeRouteD = "M52 162C96 102 182 72 302 58";

  return (
    <div className="ew-mobile-map-card" aria-hidden="true">
      <svg
        className="ew-mobile-map-svg"
        viewBox="0 0 360 220"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="ew-m-route-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1D5ED8" />
            <stop offset="65%" stopColor="#2B7FFF" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
        </defs>

        {/* Soft topographic contour background */}
        <path
          d="M0 156C44 134 94 146 138 124C182 102 228 118 282 94C320 78 344 82 360 76V220H0Z"
          fill="#E4EEF9"
          stroke="#B8CBE3"
          strokeWidth="1"
        />
        <path
          d="M0 186C58 166 112 178 166 156C220 134 274 144 360 116V220H0Z"
          fill="#DCE8F7"
          stroke="#C2D2E8"
          strokeWidth="1"
        />

        {/* Closed road bypass & red marker */}
        <path className="m-road" d="M52 162C116 170 166 168 214 156C256 146 286 110 302 58" />
        <path
          className="m-route-initial"
          pathLength="1"
          d="M52 162C116 170 166 168 214 156C256 146 286 110 302 58"
        />
        <g className="m-closed-marker">
          <path className="m-closed" d="M126 166C158 166 190 162 214 156" />
          <g transform="translate(172 163)">
            <circle r="8.5" className="m-sign" />
            <path className="m-x" d="M-3.2 -3.2L3.2 3.2M3.2 -3.2L-3.2 3.2" />
          </g>
        </g>

        {/* Safe detour route line */}
        <g className="m-route-detour-wrap">
          <path
            d={safeRouteD}
            fill="none"
            stroke="rgba(37, 99, 235, 0.22)"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <path className="m-route m-route-detour" pathLength="1" stroke="url(#ew-m-route-grad)" d={safeRouteD} />
        </g>

        {/* You-are-here origin */}
        <g transform="translate(52 162)">
          <circle r="22" fill="none" stroke="rgba(59, 130, 246, 0.18)" strokeWidth="1.2" />
          <circle className="m-pulse" r="13" />
          <circle className="m-you" r="5" />
        </g>

        {/* Evacuation center pin */}
        <g className="m-center-g" transform="translate(302 58)">
          <circle className="m-center-ring" r="20" />
          <circle className="ew-node-halo" r="22" />
          <circle cx="0" cy="0" r="14" className="m-center" />
          <path className="m-house" d="M-5.5 1L0 -4.5L5.5 1M-3.8 -0.2V5H3.8V-0.2" />
          <rect x="-1.4" y="1.8" width="2.8" height="3.2" fill="#1D58C8" />
        </g>

        {/* Label 1: Route found */}
        <g className="ew-svg-chip ew-svg-chip-c" transform="translate(92 22)">
          <rect width="118" height="28" rx="6" fill="rgba(255, 255, 255, 0.96)" stroke="#DCE7F5" strokeWidth="1" />
          <path
            d="M11 14L14 17L20 10.5"
            fill="none"
            stroke="#10B981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x="27" y="18" className="ew-svg-chip-text">ROUTE FOUND</text>
        </g>

        {/* Label 2: Road closed ahead */}
        <g className="ew-svg-chip ew-svg-chip-b" transform="translate(186 178)">
          <rect width="154" height="28" rx="6" fill="rgba(255, 255, 255, 0.96)" stroke="#DCE7F5" strokeWidth="1" />
          <circle cx="14" cy="14" r="4" fill="#DC2626" />
          <text x="25" y="18" className="ew-svg-chip-text">ROAD CLOSED AHEAD</text>
        </g>
      </svg>
    </div>
  );
}

function StepIcon({ kind }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      {kind === "locate" && (
        <>
          <circle cx="22" cy="22" r="18" stroke="#B8CBE3" strokeWidth="1" strokeDasharray="3 3" />
          <circle className="s-pulse" cx="22" cy="22" r="12" />
          <circle cx="22" cy="22" r="5.5" fill="#1B56C4" stroke="#fff" strokeWidth="2" />
        </>
      )}
      {kind === "hazards" && (
        <>
          <path className="s-flood" d="M7 29c4.5-3 9-3 13.5 0s9 3 13.5 0" />
          <circle cx="25" cy="16" r="7.5" fill="#fff" stroke="var(--alert)" strokeWidth="2" />
          <path d="M22.2 13.2l5.6 5.6M27.8 13.2l-5.6 5.6" stroke="var(--alert)" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === "route" && (
        <>
          <path className="s-route" d="M9 32c6.5 0 6.5-10 13-10s6.5-10 13-10" />
          <circle cx="9" cy="32" r="3.5" fill="#1B56C4" />
          <circle cx="35" cy="12" r="5" fill="#10B981" stroke="#fff" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

function LegendSampleMap({ activeKey }) {
  const symClass = (id) => {
    if (!activeKey) return "ew-legend-sym";
    return activeKey === id
      ? "ew-legend-sym is-highlighted"
      : "ew-legend-sym is-dimmed";
  };

  return (
    <div className="ew-legend-map-wrap" aria-hidden="true">
      <svg className="ew-legend-map" viewBox="0 0 260 156" preserveAspectRatio="xMidYMid meet">
        <rect width="260" height="156" rx="14" fill="#F4F8FD" />
        <path
          d="M0 104C45 86 92 98 142 78C192 58 228 66 260 52V156H0Z"
          fill="#E4EEF9"
          stroke="#C2D2E8"
          strokeWidth="1"
        />
        <path d="M24 118C68 110 112 108 158 100C194 94 218 68 226 42" className="m-road" />

        {/* Closed road */}
        <g className={symClass("closed")}>
          <path d="M98 106C124 104 146 100 166 96" className="m-closed" />
          <g transform="translate(134 102)">
            <circle r="8" className="m-sign" />
            <path className="m-x" d="M-3 -3L3 3M3 -3L-3 3" />
          </g>
        </g>

        {/* Safe route */}
        <g className={symClass("route")}>
          <path
            d="M34 116C62 66 138 56 218 42"
            fill="none"
            stroke="rgba(37, 99, 235, 0.22)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M34 116C62 66 138 56 218 42"
            fill="none"
            stroke="#2362C7"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx="34" cy="116" r="4.5" className="m-you" />
        </g>

        {/* Evacuation center */}
        <g transform="translate(218 42)">
          <g className={symClass("center")}>
            <circle r="18" fill="rgba(16, 185, 129, 0.22)" />
            <circle r="12" className="m-center" />
            <path className="m-house" d="M-4.5 1L0 -3.5L4.5 1M-3 0V4H3V0" />
          </g>
        </g>
      </svg>
    </div>
  );
}

function CountUpValue({ target, animate }) {
  const [display, setDisplay] = useState(() => (animate ? 0 : target));

  useEffect(() => {
    if (!animate) return undefined;
    let frameId = 0;
    const duration = 650;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };
    frameId = window.requestAnimationFrame(tick);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [target, animate]);

  return <>{animate ? display : target}</>;
}

function LiveStatusStrip({ prefersReducedMotion, t }) {
  const stripRef = useRef(null);
  const [visible, setVisible] = useState(
    () => typeof window === "undefined" || !("IntersectionObserver" in window)
  );

  const statusQuery = usePublicStatusSummary({ retry: false });

  useEffect(() => {
    const el = stripRef.current;
    if (!el || visible || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const counts = statusQuery.data?.counts;
  const isLoading = statusQuery.isLoading;
  const countKeys = ["open_centers", "closed_roads", "active_danger_reports"];
  const countsAreValid = countKeys.every(
    (key) => Number.isInteger(counts?.[key]) && counts[key] >= 0
  );
  const isUnavailable = statusQuery.isError || (!isLoading && !countsAreValid);
  const lastUpdated = statusQuery.data?.last_updated;
  const lastUpdatedTime = lastUpdated ? formatManilaTime(lastUpdated) : "";
  const lastUpdatedLabel = isLoading
    ? t("status.loading")
    : lastUpdatedTime || t("status.unavailable");

  const shouldAnimate = visible && !prefersReducedMotion;

  return (
    <section ref={stripRef} className="ew-status-strip" aria-label={t("status.ariaLabel")}>
      <div className="ew-wrap">
        {isLoading ? (
          <div className="ew-status-grid is-loading" aria-busy="true">
            <div className="ew-status-item"><span className="ew-status-skel-num" /><span className="ew-status-skel-lbl" /></div>
            <div className="ew-status-item"><span className="ew-status-skel-num" /><span className="ew-status-skel-lbl" /></div>
            <div className="ew-status-item"><span className="ew-status-skel-num" /><span className="ew-status-skel-lbl" /></div>
          </div>
        ) : isUnavailable ? (
          <div className="ew-status-grid" role="status" aria-live="polite">
            {[
              ["open_centers", t("status.centers")],
              ["closed_roads", t("status.roads")],
              ["active_danger_reports", t("status.hazards")],
            ].map(([key, label]) => (
              <div className="ew-status-item" key={key}>
                <strong className="ew-status-num">{t("status.unavailable")}</strong>
                <span className="ew-status-label">{label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="ew-status-grid">
            <div className="ew-status-item">
              <strong className="ew-status-num">
                {visible ? <CountUpValue target={counts.open_centers} animate={shouldAnimate} /> : counts.open_centers}
              </strong>
              <span className="ew-status-label">{t("status.centers")}</span>
            </div>
            <div className="ew-status-item">
              <strong className="ew-status-num">
                {visible ? <CountUpValue target={counts.closed_roads} animate={shouldAnimate} /> : counts.closed_roads}
              </strong>
              <span className="ew-status-label">{t("status.roads")}</span>
            </div>
            <div className="ew-status-item">
              <strong className="ew-status-num">
                {visible ? <CountUpValue target={counts.active_danger_reports} animate={shouldAnimate} /> : counts.active_danger_reports}
              </strong>
              <span className="ew-status-label">{t("status.hazards")}</span>
            </div>
          </div>
        )}
        <p className="ew-status-updated">
          {t("status.updated")} {lastUpdatedLabel}{lastUpdatedTime ? ` · ${t("status.serverTime")}` : ""}
        </p>
      </div>
    </section>
  );
}

function ActiveOperationBanner({ t }) {
  const query = usePublicOperationAlert({ retry: false });
  const operation = query.data?.operation;
  if (!operation?.active) return null;

  return (
    <div className="ew-operation-alert" role="alert" aria-live="assertive">
      <strong>{t("operation.active")}</strong>
    </div>
  );
}

const isStandalone = () => {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone
  );
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.deferredPrompt = e;
  });
  window.addEventListener("appinstalled", () => {
    window.deferredPrompt = null;
  });
}

export default function LandingPage() {
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const signUpDialogRef = useRef(null);
  const rootRef = useRef(null);
  const heroStageRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [isHeroInView, setIsHeroInView] = useState(true);
  const [isTabHidden, setIsTabHidden] = useState(() =>
    typeof document !== "undefined" ? document.hidden : false
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  const [hoveredLegendKey, setHoveredLegendKey] = useState(null);
  const [focusedLegendKey, setFocusedLegendKey] = useState(null);
  const [tappedLegendKey, setTappedLegendKey] = useState(null);
  const activeLegendKey = hoveredLegendKey || focusedLegendKey || tappedLegendKey;
  const [isCompactHero, setIsCompactHero] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 768px)").matches
      : false
  );
  const [deferredPrompt, setDeferredPrompt] = useState(() => {
    if (typeof window === "undefined" || isStandalone()) return null;
    return window.deferredPrompt || null;
  });
  const [language, setLanguage] = useState(() => {
    try {
      const saved = window.localStorage.getItem("evacway-landing-language");
      return ["en", "fil", "ceb"].includes(saved) ? saved : "en";
    } catch {
      return "en";
    }
  });
  const t = (key) => getLandingText(language, key);

  const changeLanguage = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    try {
      window.localStorage.setItem("evacway-landing-language", nextLanguage);
    } catch {
      // Language selection still applies for this visit if storage is unavailable.
    }
  };

  const handleInstallClick = async () => {
    const promptEvent = deferredPrompt || (typeof window !== "undefined" ? window.deferredPrompt : null);
    if (!promptEvent) return;
    promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch {
      // prompt resolved or dismissed
    }
    setDeferredPrompt(null);
    if (typeof window !== "undefined") {
      window.deferredPrompt = null;
    }
  };

  const openLogin = () => {
    signUpDialogRef.current?.close();
    dialogRef.current?.showModal();
  };

  const openSignUp = () => {
    dialogRef.current?.close();
    window.requestAnimationFrame(() => {
      setSignUpOpen(true);
    });
  };

  useEffect(() => {
    if (isStandalone()) {
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        window.deferredPrompt = null;
      }
      return undefined;
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.deferredPrompt = e;
      if (!isStandalone()) {
        setDeferredPrompt(e);
      }
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        window.deferredPrompt = null;
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    let mediaQuery = null;
    let handleMediaChange = null;
    if (typeof window.matchMedia === "function") {
      mediaQuery = window.matchMedia("(display-mode: standalone)");
      handleMediaChange = (e) => {
        if (e.matches) {
          setDeferredPrompt(null);
          if (typeof window !== "undefined") {
            window.deferredPrompt = null;
          }
        }
      };
      mediaQuery.addEventListener?.("change", handleMediaChange);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (mediaQuery && handleMediaChange) {
        mediaQuery.removeEventListener?.("change", handleMediaChange);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (event) => setIsCompactHero(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    let rafId = 0;
    const updateOnScroll = () => {
      rafId = 0;
      const y = window.scrollY || window.pageYOffset;
      setScrolled(y > 8);
    };
    const onScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(updateOnScroll);
      }
    };
    updateOnScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setPrefersReducedMotion(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setIsTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const stageEl = heroStageRef.current;
    if (!stageEl || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]) {
          setIsHeroInView(entries[0].isIntersecting);
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const revealEls = root.querySelectorAll(".ew-reveal");
    if (!("IntersectionObserver" in window)) {
      revealEls.forEach((el) => el.classList.add("ew-visible"));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("ew-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="ew" ref={rootRef}>
      <a href="#ew-main" className="ew-skip-link">
        Skip to content
      </a>

      {/* Top Navigation matching the reference design */}
      <header className={`ew-header${scrolled ? " ew-header-scrolled" : ""}`}>
        <div className="ew-header-inner">
          <Logo />
          <div className="ew-nav-right">
            <nav className="ew-nav-links" aria-label={t("nav.sections")}>
              <Link to="/map">{t("nav.explore")}</Link>
              <a href="#ew-key-title">{t("nav.features")}</a>
              <a href="#ew-steps-title">{t("nav.howItWorks")}</a>
            </nav>
            <label className="ew-language-control">
              <span className="sr-only">{t("language.label")}</span>
              <select value={language} onChange={changeLanguage} aria-label={t("language.label")}>
                {landingLocaleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(`language.${option.labelKey}`)}
                  </option>
                ))}
              </select>
            </label>
            {deferredPrompt && (
              <button
                type="button"
                className="ew-btn ew-btn-outline ew-install-nav ds-btn ds-btn--ghost"
                onClick={handleInstallClick}
              >
                {t("nav.install")}
              </button>
            )}
            <button
              type="button"
              className="ew-btn ew-btn-quiet ew-btn-login-pill ds-btn ds-btn--ghost"
              onClick={openLogin}
            >
              {t("nav.login")}
            </button>
            <button type="button" className="ew-btn ew-btn-outline ew-signup-nav ds-btn ds-btn--ghost" onClick={openSignUp}>
              {t("nav.signup")}
            </button>
          </div>
        </div>
      </header>

      {/* Full-Bleed Topographic Relief Hero Stage */}
      <div
        ref={heroStageRef}
        className={`ew-stage${!isHeroInView || isTabHidden ? " ew-hero-paused" : ""}`}
      >
        <span className="ew-cloud ew-cloud-a" aria-hidden="true" />
        <span className="ew-cloud ew-cloud-b" aria-hidden="true" />

        <div className="ew-map-wrap" aria-hidden="true">
          <div className="ew-map">
            <MapArt preserveAspectRatio={isCompactHero ? "xMaxYMax slice" : "xMaxYMid slice"} />
          </div>
          <span className="ew-chip ew-chip-b" aria-hidden="true"><i />Road closed ahead</span>
          <span className="ew-chip ew-chip-c" aria-hidden="true"><i />Route found</span>
        </div>

        <section className="ew-hero" aria-labelledby="ew-hero-title">
          <div className="ew-hero-copy">
            <div className="ew-lgu-hero-pill">
              <img src="/mdrrmo-logo.png" alt="MDRRMO Sogod Logo" className="ew-lgu-hero-logo ew-mdrrmo-logo" />
              <span>Municipal Disaster Risk Reduction and Management Office</span>
            </div>
            <h1 id="ew-hero-title">{t("hero.title")}</h1>
            <svg className="ew-hero-rule" width="76" height="10" viewBox="0 0 76 10" aria-hidden="true">
              <path
                d="M2 6.5C22 4 46 6.5 74 4.5"
                fill="none"
                stroke="#2362C7"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
            <p className="ew-lede">{t("hero.lede")}</p>
            <div className="ew-actions">
              <Link to="/map" className="ew-btn ew-btn-primary ds-btn ds-btn--primary">
                <span>{t("hero.explore")}</span>
                <svg className="ew-btn-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <button
                type="button"
                className="ew-btn ew-btn-outline ew-find-center ds-btn ds-btn--ghost"
                onClick={() => navigate("/map", { state: { openMyCenter: true } })}
              >
                {t("hero.findCenter")}
              </button>
              <span className="ew-note" aria-hidden="true">{t("hero.noAccount")}</span>
            </div>
            <MobileRouteCard />
          </div>
        </section>

        <div className="ew-waves" aria-hidden="true">
          <span className="ew-wave ew-wave-1" />
          <span className="ew-wave ew-wave-2" />
          <span className="ew-wave ew-wave-3" />
        </div>
      </div>

      <main id="ew-main" className="ew-main">
        <LiveStatusStrip prefersReducedMotion={prefersReducedMotion} t={t} />
        <ActiveOperationBanner t={t} />

        {/* Three steps to a safe route */}
        <section className="ew-steps ew-reveal" aria-labelledby="ew-steps-title">
          <div className="ew-wrap">
            <h2 id="ew-steps-title">{t("steps.title")}</h2>
            <ol className="ew-steps-list">
              {STEPS.map((kind, i) => (
                <li
                  key={kind}
                  className="ew-step ew-stagger-item"
                  style={{ "--ew-stagger": i }}
                >
                  <div className="ew-step-icon">
                    <StepIcon kind={kind} />
                    <span className="ew-step-n">{i + 1}</span>
                  </div>
                  <h3>{t(`steps.${kind}.title`)}</h3>
                  <p>{t(`steps.${kind}.text`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Reading the map */}
        <section className="ew-key ew-reveal" aria-labelledby="ew-key-title">
          <div className="ew-wrap">
            <div className="ew-key-sheet">
              <h2 id="ew-key-title">{t("mapKey.title")}</h2>
              <div className="ew-key-layout">
                <LegendSampleMap activeKey={activeLegendKey} />
                <div className="ew-key-grid" role="list">
                  {MAP_KEY.map((id, i) => {
                    const isActive = activeLegendKey === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="listitem"
                        className={`ew-key-item ew-stagger-item${isActive ? " is-active" : ""}`}
                        style={{ "--ew-stagger": i }}
                        aria-pressed={tappedLegendKey === id}
                        onMouseEnter={() => setHoveredLegendKey(id)}
                        onMouseLeave={() => setHoveredLegendKey(null)}
                        onFocus={() => setFocusedLegendKey(id)}
                        onBlur={() => setFocusedLegendKey(null)}
                        onClick={() =>
                          setTappedLegendKey((prev) => (prev === id ? null : id))
                        }
                      >
                        <span className={`ew-sw ew-sw-${id}`} aria-hidden="true" />
                        <span className="ew-key-dt">{t(`mapKey.${id}.label`)}</span>
                        <span className="ew-key-dd">{t(`mapKey.${id}.text`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Account access for residents and staff */}
        <section className="ew-account ew-reveal" aria-labelledby="ew-account-title">
          <div className="ew-wrap">
            <div className="ew-account-inner">
              <div>
                <h2 id="ew-account-title">{t("account.title")}</h2>
                <p>{t("account.text")}</p>
                <p className="ew-signup-note">{t("account.signupNote")}</p>
              </div>
              <button type="button" className="ew-btn ew-btn-outline ds-btn ds-btn--ghost" onClick={openLogin}>
                {t("nav.login")}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="ew-footer">
        <div className="ew-wrap ew-footer-inner">
          <div className="ew-footer-brand-col">
            <div className="ew-footer-logos">
              <Link to="/" className="ew-logo" aria-label="EvacWay home">
                <img src="/evacway-logo-text-dark.png" alt="EvacWay" className="ew-logo-image" />
              </Link>
              <span className="ew-footer-divider" aria-hidden="true" />
              <div className="ew-footer-partners">
                <div className="ew-footer-lgu">
                  <img src="/lgu-logo.png" alt="Municipality of Sogod Seal" className="ew-footer-lgu-logo" />
                  <div className="ew-footer-lgu-info">
                    <span className="ew-footer-lgu-title">Municipality of Sogod</span>
                    <span className="ew-footer-lgu-sub">Province of Southern Leyte</span>
                  </div>
                </div>
                <span className="ew-footer-divider ew-footer-partner-divider" aria-hidden="true" />
                <div className="ew-footer-lgu">
                  <img src="/mdrrmo-logo.png" alt="MDRRMO Sogod Logo" className="ew-footer-lgu-logo ew-mdrrmo-logo-footer" />
                  <div className="ew-footer-lgu-info">
                    <span className="ew-footer-lgu-title">MDRRMO Sogod</span>
                    <span className="ew-footer-lgu-sub">Municipal Disaster Risk Reduction &amp; Management Office</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="ew-footer-tagline">
              Official disaster evacuation and safe route advisory system for the Municipality of Sogod, Southern Leyte.
            </p>
            {deferredPrompt && (
              <button
                type="button"
                className="ew-btn ew-btn-outline ew-install-footer ds-btn ds-btn--ghost"
                onClick={handleInstallClick}
              >
                Install EvacWay
              </button>
            )}
          </div>
          <nav className="ew-footer-site-map" aria-label={t("footer.siteMap")}>
            <h2>{t("footer.siteMap")}</h2>
            <Link to="/map">{t("hero.explore")}</Link>
            <a href="#ew-key-title">{t("nav.features")}</a>
            <a href="#ew-steps-title">{t("nav.howItWorks")}</a>
            <Link to="/data-privacy-notice">{t("footer.privacy")}</Link>
          </nav>
          <div className="ew-footer-contact">
            <h2>{t("footer.contact")}</h2>
            <strong>{t("footer.mdrrmo")}</strong>
            <span className="ew-footer-contact-label">{t("footer.verifiedHotline")}</span>
            <div className="ew-footer-hotline-numbers" aria-label={`${t("footer.mdrrmo")} ${t("footer.verifiedHotline")}`}>
              {mdrrmoHotlines.map((item) => (
                <a
                  key={item.number}
                  href={`tel:${item.number.replace(/[^\d+]/g, "")}`}
                  aria-label={`Call ${t("footer.mdrrmo")} at ${item.number}`}
                >
                  {item.number}
                </a>
              ))}
            </div>
          </div>
          <div className="ew-footer-bottom">
            <p className="ew-footer-credit">
              Roads from OpenStreetMap. MDRRMO Sogod, Southern Leyte.
            </p>
            <p className="ew-footer-copy">&copy; 2026 EvacWay &bull; Municipality of Sogod, Southern Leyte. {t("footer.copyright")}</p>
          </div>
        </div>
      </footer>

      <LoginDialog dialogRef={dialogRef} onOpenSignUp={openSignUp} />
      <ResidentSignUpDialog
        dialogRef={signUpDialogRef}
        isOpen={signUpOpen}
        onClose={() => setSignUpOpen(false)}
        onOpenLogin={openLogin}
      />
    </div>
  );
}
