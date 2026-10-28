import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

// Wrap any page that needs login with this. Pass allowedRoles to also
// restrict by role, e.g. <ProtectedRoute allowedRoles={['admin']}>
function ProtectedRoute({ children, allowedRoles }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const redirectPath = user.role === "lgu_personnel" ? "/lgu" : "/";
    return <Navigate to={redirectPath} state={{ flashMessage: "Admins only" }} replace />;
  }

  return children;
}

export default ProtectedRoute;
