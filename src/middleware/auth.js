import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    // Tenant Schema
    req.tenantSchema = decoded.tenant_schema;

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};