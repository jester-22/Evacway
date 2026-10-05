import { useEffect, useState } from "react";
import { api } from "../services/api";
import { displayEntityName } from "../utils/displayEntityName";

function RoomFamilyChecklist({
  room,
  onClose,
  onAssigned,
}) {
  const [families, setFamilies] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFamilies();
  }, [room]);

  async function loadFamilies() {
    try {
      setLoading(true);

      const data = await api.getAvailableFamilies(
        room.id
      );

      setFamilies(data);
    } catch (error) {
      console.error(error);
      alert("Failed to load families.");
    } finally {
      setLoading(false);
    }
  }

  function toggleFamily(id) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter(
          (item) => item !== id
        );
      }

      return [...current, id];
    });
  }

  const selectedFamilies = families.filter(
    (family) =>
      selected.includes(family.id)
  );

  const totalMembers = selectedFamilies.reduce(
    (total, family) =>
      total + Number(family.family_members || 0),
    0
  );

  async function handleAssign() {
    if (selected.length === 0) {
      alert("Select at least one family.");
      return;
    }

    if (totalMembers > room.capacity) {
      alert(
        `Room capacity is ${room.capacity}, but the selected families have ${totalMembers} members.`
      );
      return;
    }

    try {
      setSaving(true);

      await api.assignFamilies(
        room.id,
        selected
      );

      alert("Families assigned successfully.");

      if (onAssigned) {
        onAssigned();
      }

      onClose();

    } catch (error) {
      console.error(error);
      alert(
        error.message ||
        "Failed to assign families."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="room-modal-overlay">
      <div className="room-family-modal">

        <div className="room-modal-header">
          <div>
            <h2>
              Assign Families
            </h2>

            <p>
              {room.room_number}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="room-modal-close"
          >
            ×
          </button>
        </div>

        <div className="room-capacity-info">
          <span>
            Room Capacity: {room.capacity}
          </span>

          <span>
            Selected: {totalMembers}
          </span>
        </div>

        {loading ? (
          <div className="room-family-loading">
            Loading families...
          </div>
        ) : families.length === 0 ? (
          <div className="room-family-empty">
            No available families.
          </div>
        ) : (
          <div className="room-family-list">

            {families.map((family) => (

              <label
                key={family.id}
                className="room-family-item"
              >

                <input
                  type="checkbox"
                  checked={selected.includes(
                    family.id
                  )}
                  onChange={() =>
                    toggleFamily(family.id)
                  }
                />

                <div>
                  <strong>
                    {family.household_head_name}
                  </strong>

                  <div>
                    {displayEntityName(family.barangay, "Barangay not set")}
                  </div>

                  <small>
                    {family.family_members}{" "}
                    member
                    {family.family_members !== 1
                      ? "s"
                      : ""}
                  </small>
                </div>

              </label>

            ))}

          </div>
        )}

        <div className="room-modal-actions">

          <button
            type="button"
            onClick={onClose}
            className="room-cancel-button"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleAssign}
            className="room-save-button"
            disabled={
              saving ||
              selected.length === 0
            }
          >
            {saving
              ? "Assigning..."
              : "Assign Families"}
          </button>

        </div>

      </div>
    </div>
  );
}

export default RoomFamilyChecklist;