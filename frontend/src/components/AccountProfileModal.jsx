import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * AccountProfileModal is deprecated. Profile management is now handled
 * on the full /profile page (ManageProfile.jsx).
 */
export default function AccountProfileModal({ onClose }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof onClose === "function") onClose();
    navigate("/profile");
  }, [navigate, onClose]);

  return null;
}