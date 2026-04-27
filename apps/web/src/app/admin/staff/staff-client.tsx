"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatCents } from "../admin-api";

type EmployeeRole = "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";
type DriverAvailabilityStatus =
  | "AVAILABLE"
  | "ON_DELIVERY"
  | "OFF_SHIFT"
  | "UNAVAILABLE"
  | "INACTIVE";

type StaffSummary = {
  total_team: number;
  active_team: number;
  managers: number;
  cashiers: number;
  kitchen: number;
  drivers: number;
  drivers_available: number;
  drivers_on_delivery: number;
};

type StaffMember = {
  user_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  employee_role: EmployeeRole;
  is_active: boolean;
  phone: string | null;
  email: string | null;
  hire_date: string | null;
  hourly_rate_cents: number | null;
  created_at: string;
  driver_profile: {
    availability_status: DriverAvailabilityStatus;
    is_on_delivery: boolean;
    vehicle_type: string | null;
    vehicle_identifier: string | null;
    is_active: boolean;
  } | null;
};

type StaffListResponse = {
  summary: StaffSummary;
  items: StaffMember[];
};

type FilterMode = "ALL" | "IN_STORE" | "DRIVERS";

const ROLE_OPTIONS: Array<{ value: EmployeeRole; label: string }> = [
  { value: "KITCHEN", label: "Kitchen staff" },
  { value: "CASHIER", label: "Cashier" },
  { value: "MANAGER", label: "Manager" },
  { value: "DRIVER", label: "Driver" },
];

const DRIVER_STATUS_OPTIONS: Array<{
  value: DriverAvailabilityStatus;
  label: string;
}> = [
  { value: "AVAILABLE", label: "Available" },
  { value: "OFF_SHIFT", label: "Off shift" },
  { value: "UNAVAILABLE", label: "Unavailable" },
  { value: "INACTIVE", label: "Inactive" },
];

function roleLabel(role: EmployeeRole) {
  switch (role) {
    case "MANAGER":
      return "Manager";
    case "CASHIER":
      return "Cashier";
    case "KITCHEN":
      return "Kitchen";
    case "DRIVER":
      return "Driver";
    default:
      return role;
  }
}

function driverStatusLabel(status: DriverAvailabilityStatus) {
  switch (status) {
    case "AVAILABLE":
      return "Available";
    case "ON_DELIVERY":
      return "On delivery";
    case "OFF_SHIFT":
      return "Off shift";
    case "UNAVAILABLE":
      return "Unavailable";
    case "INACTIVE":
      return "Inactive";
    default:
      return status;
  }
}

function roleClassName(role: EmployeeRole) {
  switch (role) {
    case "MANAGER":
      return "admin-role-badge admin-role-badge--manager";
    case "CASHIER":
      return "admin-role-badge admin-role-badge--cashier";
    case "KITCHEN":
      return "admin-role-badge admin-role-badge--kitchen";
    case "DRIVER":
      return "admin-role-badge admin-role-badge--driver";
    default:
      return "admin-role-badge";
  }
}

function driverStatusClassName(status: DriverAvailabilityStatus) {
  switch (status) {
    case "AVAILABLE":
      return "admin-driver-status admin-driver-status--available";
    case "ON_DELIVERY":
      return "admin-driver-status admin-driver-status--delivery";
    case "OFF_SHIFT":
      return "admin-driver-status admin-driver-status--offshift";
    default:
      return "admin-driver-status admin-driver-status--inactive";
  }
}

export function StaffClient() {
  const session = useSession();
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("ALL");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    employeeRole: "KITCHEN" as EmployeeRole,
    employeePin: "",
    hourlyRate: "",
    hireDate: "",
    isActive: true,
    availabilityStatus: "AVAILABLE" as DriverAvailabilityStatus,
    vehicleType: "",
    vehicleIdentifier: "",
  });

  const isDriverRole = form.employeeRole === "DRIVER";
  const isEditing = editingUserId !== null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch("/api/v1/admin/staff"),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setData(json.data as StaffListResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, [session.clear, session.refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingUserId(null);
    setForm({
      fullName: "",
      phone: "",
      email: "",
      employeeRole: "KITCHEN",
      employeePin: "",
      hourlyRate: "",
      hireDate: "",
      isActive: true,
      availabilityStatus: "AVAILABLE",
      vehicleType: "",
      vehicleIdentifier: "",
    });
  };

  const startEditing = (member: StaffMember) => {
    setSuccess(null);
    setError(null);
    setEditingUserId(member.user_id);
    setForm({
      fullName: member.display_name,
      phone: member.phone ?? "",
      email: member.email ?? "",
      employeeRole: member.employee_role,
      employeePin: "",
      hourlyRate:
        member.hourly_rate_cents != null
          ? String(member.hourly_rate_cents / 100)
          : "",
      hireDate: member.hire_date
        ? new Date(member.hire_date).toISOString().slice(0, 10)
        : "",
      isActive: member.is_active,
      availabilityStatus:
        member.driver_profile?.availability_status ?? "AVAILABLE",
      vehicleType: member.driver_profile?.vehicle_type ?? "",
      vehicleIdentifier: member.driver_profile?.vehicle_identifier ?? "",
    });
  };

  const deleteDriver = async (member: StaffMember) => {
    if (member.employee_role !== "DRIVER") return;

    const confirmed = window.confirm(
      `Delete driver ${member.display_name}? This will remove them from the active driver roster.`,
    );
    if (!confirmed) return;

    setDeletingUserId(member.user_id);
    setError(null);
    setSuccess(null);

    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/admin/staff/${member.user_id}`, {
            method: "DELETE",
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Delete failed (${res.status})`,
        );
      }

      if (editingUserId === member.user_id) {
        resetForm();
      }

      setSuccess("Driver deleted successfully.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setDeletingUserId(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const trimmedHourlyRate = form.hourlyRate.trim();
    const hourlyRateNumber = trimmedHourlyRate ? Number(trimmedHourlyRate) : null;
    if (
      hourlyRateNumber != null &&
      (!Number.isFinite(hourlyRateNumber) || hourlyRateNumber < 0)
    ) {
      setSaving(false);
      setError("Hourly rate must be a valid positive amount.");
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        full_name: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        employee_role: form.employeeRole,
        employee_pin: form.employeePin.trim() || undefined,
        hourly_rate_cents:
          hourlyRateNumber != null ? Math.round(hourlyRateNumber * 100) : undefined,
        hire_date: form.hireDate || undefined,
        is_active: form.isActive,
      };

      if (form.employeeRole === "DRIVER") {
        payload.availability_status = form.availabilityStatus;
        payload.vehicle_type = form.vehicleType.trim() || undefined;
        payload.vehicle_identifier = form.vehicleIdentifier.trim() || undefined;
      }

      const res = await withSilentRefresh(
        () =>
          adminApiFetch(
            isEditing
              ? `/api/v1/admin/staff/${editingUserId}`
              : "/api/v1/admin/staff",
            {
              method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            },
          ),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Create failed (${res.status})`,
        );
      }

      resetForm();
      setSuccess(
        isEditing
          ? form.employeeRole === "DRIVER"
            ? "Driver updated successfully."
            : "Staff member updated successfully."
          : form.employeeRole === "DRIVER"
            ? "Driver added and ready for dispatch setup."
            : "Staff member added successfully.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = (data?.items ?? []).filter((item) => {
    if (filter === "DRIVERS") return item.employee_role === "DRIVER";
    if (filter === "IN_STORE") return item.employee_role !== "DRIVER";
    return true;
  });

  return (
    <div className="admin-staff-shell">
      <section className="surface-card admin-section-lead">
        <div className="admin-section-lead__row">
          <div>
            <p className="surface-eyebrow" style={{ margin: 0 }}>
              Team management
            </p>
            <h1>Staff and drivers</h1>
            <p className="surface-muted">
              Add managers, kitchen crew, cashiers, and delivery drivers in one
              place. Driver records created here flow straight into the KDS
              assign-driver picker.
            </p>
          </div>
          <div className="admin-section-lead__actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSuccess(null);
                void load();
              }}
              disabled={loading}
              style={{ width: "auto" }}
            >
              {loading ? "Refreshing..." : "Refresh roster"}
            </button>
          </div>
        </div>
      </section>

      <div className="admin-staff-summary">
        <div className="surface-card admin-staff-stat">
          <span className="admin-staff-stat__label">Total team</span>
          <strong className="admin-staff-stat__value">
            {data?.summary.total_team ?? 0}
          </strong>
        </div>
        <div className="surface-card admin-staff-stat">
          <span className="admin-staff-stat__label">Active team</span>
          <strong className="admin-staff-stat__value">
            {data?.summary.active_team ?? 0}
          </strong>
        </div>
        <div className="surface-card admin-staff-stat">
          <span className="admin-staff-stat__label">Drivers available</span>
          <strong className="admin-staff-stat__value">
            {data?.summary.drivers_available ?? 0}
          </strong>
        </div>
        <div className="surface-card admin-staff-stat">
          <span className="admin-staff-stat__label">Drivers on delivery</span>
          <strong className="admin-staff-stat__value">
            {data?.summary.drivers_on_delivery ?? 0}
          </strong>
        </div>
      </div>

      <div className="admin-staff-main">
        <section className="surface-card admin-staff-form">
          <div className="admin-staff-form__head">
            <div>
              <p className="surface-eyebrow" style={{ margin: 0 }}>
                {isEditing ? "Edit teammate" : "Add teammate"}
              </p>
              <h2 style={{ margin: "0.2rem 0 0" }}>
                {isEditing ? "Update team record" : "Create a staff record"}
              </h2>
            </div>
            <span className={roleClassName(form.employeeRole)}>
              {roleLabel(form.employeeRole)}
            </span>
          </div>

          <form onSubmit={submit} className="admin-form-stack">
            <div className="admin-form-grid">
              <label className="admin-form-field admin-form-field--full">
                <span>Full name</span>
                <input
                  className="admin-form-input"
                  value={form.fullName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fullName: event.target.value,
                    }))
                  }
                  placeholder="e.g. Maya Johnson"
                  required
                />
              </label>

              <label className="admin-form-field">
                <span>Role</span>
                <select
                  className="admin-form-input"
                  value={form.employeeRole}
                  disabled={isEditing}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      employeeRole: event.target.value as EmployeeRole,
                    }))
                  }
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-form-field">
                <span>Phone</span>
                <input
                  className="admin-form-input"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  placeholder="(555) 123-4567"
                  required
                />
              </label>

              <label className="admin-form-field">
                <span>Email</span>
                <input
                  className="admin-form-input"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>

              <label className="admin-form-field">
                <span>Employee PIN</span>
                <input
                  className="admin-form-input"
                  inputMode="numeric"
                  value={form.employeePin}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      employeePin: event.target.value,
                    }))
                  }
                  placeholder="5 digits"
                  maxLength={5}
                />
              </label>

              <label className="admin-form-field">
                <span>Hourly rate ($)</span>
                <input
                  className="admin-form-input"
                  inputMode="decimal"
                  value={form.hourlyRate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      hourlyRate: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>

              <label className="admin-form-field">
                <span>Hire date</span>
                <input
                  className="admin-form-input"
                  type="date"
                  value={form.hireDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      hireDate: event.target.value,
                    }))
                  }
                />
              </label>

              {isDriverRole ? (
                <>
                  <label className="admin-form-field">
                    <span>Driver status</span>
                    <select
                      className="admin-form-input"
                      value={form.availabilityStatus}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          availabilityStatus:
                            event.target.value as DriverAvailabilityStatus,
                        }))
                      }
                    >
                      {DRIVER_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-form-field">
                    <span>Vehicle type</span>
                    <input
                      className="admin-form-input"
                      value={form.vehicleType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          vehicleType: event.target.value,
                        }))
                      }
                      placeholder="Car, bike, scooter..."
                    />
                  </label>

                  <label className="admin-form-field admin-form-field--full">
                    <span>Vehicle identifier</span>
                    <input
                      className="admin-form-input"
                      value={form.vehicleIdentifier}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          vehicleIdentifier: event.target.value,
                        }))
                      }
                      placeholder="Plate or short vehicle note"
                    />
                  </label>
                </>
              ) : null}
            </div>

            <label className="admin-toggle-row">
              <span>
                <strong>Active right away</strong>
                <small>Inactive team members stay in the roster but won&apos;t be usable in live flows.</small>
              </span>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                    availabilityStatus:
                      !event.target.checked && current.employeeRole === "DRIVER"
                        ? "INACTIVE"
                        : current.availabilityStatus,
                  }))
                }
              />
            </label>

            {success ? <p className="admin-surface-success">{success}</p> : null}
            {error ? <p className="surface-error">{error}</p> : null}

            <div className="admin-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={resetForm}
                disabled={saving}
                style={{ width: "auto" }}
              >
                {isEditing ? "Cancel edit" : "Reset"}
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving}
                style={{ width: "auto" }}
              >
                {saving
                  ? "Saving..."
                  : isEditing
                    ? `Save ${roleLabel(form.employeeRole)}`
                    : `Add ${roleLabel(form.employeeRole)}`}
              </button>
            </div>
          </form>
        </section>

        <section className="surface-card admin-staff-roster-panel">
          <div className="admin-staff-roster-panel__head">
            <div>
              <p className="surface-eyebrow" style={{ margin: 0 }}>
                Live roster
              </p>
              <h2 style={{ margin: "0.2rem 0 0" }}>Current team</h2>
            </div>
            <div className="admin-staff-filters" role="tablist" aria-label="Roster filters">
              {[
                { key: "ALL" as const, label: "All team" },
                { key: "IN_STORE" as const, label: "In-store staff" },
                { key: "DRIVERS" as const, label: "Drivers" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`admin-filter-chip${
                    filter === tab.key ? " admin-filter-chip--active" : ""
                  }`}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading && !data ? (
            <p className="surface-muted">Loading roster...</p>
          ) : filteredItems.length === 0 ? (
            <div className="admin-empty-state">
              <strong>No team members yet</strong>
              <p className="surface-muted">
                Add the first staff record here and drivers will begin appearing
                in the KDS assignment flow once they are active.
              </p>
            </div>
          ) : (
            <div className="admin-staff-roster">
              {filteredItems.map((member) => (
                <article key={member.user_id} className="admin-staff-member">
                  <div className="admin-staff-member__top">
                    <div>
                      <div className="admin-staff-member__title">
                        <h3>{member.display_name}</h3>
                        <span className={roleClassName(member.employee_role)}>
                          {roleLabel(member.employee_role)}
                        </span>
                        {!member.is_active ? (
                          <span className="admin-driver-status admin-driver-status--inactive">
                            Inactive
                          </span>
                        ) : null}
                      </div>
                      <div className="admin-staff-member__meta">
                        {member.phone ? <span>{member.phone}</span> : null}
                        {member.email ? <span>{member.email}</span> : null}
                      </div>
                    </div>

                    <div className="admin-staff-member__actions">
                      {member.driver_profile ? (
                        <span
                          className={driverStatusClassName(
                            member.driver_profile.availability_status,
                          )}
                        >
                          {driverStatusLabel(
                            member.driver_profile.availability_status,
                          )}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="admin-card-edit-btn"
                        onClick={() => startEditing(member)}
                        disabled={deletingUserId === member.user_id}
                      >
                        Edit
                      </button>
                      {member.employee_role === "DRIVER" ? (
                        <button
                          type="button"
                          className="admin-card-delete-btn"
                          onClick={() => void deleteDriver(member)}
                          disabled={deletingUserId === member.user_id}
                        >
                          {deletingUserId === member.user_id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="admin-staff-member__details">
                    <div className="admin-staff-member__detail">
                      <span>Hourly rate</span>
                      <strong>
                        {member.hourly_rate_cents != null
                          ? formatCents(member.hourly_rate_cents)
                          : "Not set"}
                      </strong>
                    </div>
                    <div className="admin-staff-member__detail">
                      <span>Hire date</span>
                      <strong>
                        {member.hire_date
                          ? new Date(member.hire_date).toLocaleDateString()
                          : "Not set"}
                      </strong>
                    </div>
                    <div className="admin-staff-member__detail">
                      <span>Created</span>
                      <strong>
                        {new Date(member.created_at).toLocaleDateString()}
                      </strong>
                    </div>
                    {member.driver_profile ? (
                      <div className="admin-staff-member__detail">
                        <span>Vehicle</span>
                        <strong>
                          {member.driver_profile.vehicle_type ||
                          member.driver_profile.vehicle_identifier
                            ? [
                                member.driver_profile.vehicle_type,
                                member.driver_profile.vehicle_identifier,
                              ]
                                .filter(Boolean)
                                .join(" | ")
                            : "Not set"}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
