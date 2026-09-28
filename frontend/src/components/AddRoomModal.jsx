import { useState } from "react";

function AddRoomModal({
  center,
  location,
  onPickLocation,
  onSave,
  onClose,
  saving = false,
}) {
  const [roomNumber, setRoomNumber] = useState("");
  const [capacity, setCapacity] = useState("");

  function handleSubmit(e) {
    e.preventDefault();

    if (!roomNumber.trim()) {
      alert("Room number is required.");
      return;
    }

    if (!capacity || Number(capacity) <= 0) {
      alert("Enter a valid room capacity.");
      return;
    }

    if (!location) {
      alert("Please select the room location on the map.");
      return;
    }

    onSave({
      room_number: roomNumber.trim(),
      capacity: Number(capacity),
      latitude: location.lat,
      longitude: location.lng,
    });
  }

  return (
    <div className="room-modal-overlay">
      <div className="room-modal">

        <div className="room-modal-header">
          <div>
            <h2>Add Room</h2>
            <p>{center?.properties?.name}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="room-modal-close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>

          <label>
            Room Number
          </label>

          <input
            type="text"
            value={roomNumber}
            onChange={(e) =>
              setRoomNumber(e.target.value)
            }
            placeholder="Example: Room 101"
          />

          <label>
            Capacity
          </label>

          <input
            type="number"
            min="1"
            value={capacity}
            onChange={(e) =>
              setCapacity(e.target.value)
            }
            placeholder="Number of people"
          />

          <label>
            Room Location
          </label>

          {location ? (
            <div className="room-location-selected">
              Location selected
              <br />
              <small>
                {location.lat.toFixed(6)},{" "}
                {location.lng.toFixed(6)}
              </small>
            </div>
          ) : (
            <div className="room-location-empty">
              No location selected
            </div>
          )}

          <button
            type="button"
            className="room-pick-location"
            onClick={onPickLocation}
          >
            Pick Location on Map
          </button>

          <div className="room-modal-actions">

            <button
              type="button"
              onClick={onClose}
              className="room-cancel-button"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="room-save-button"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Room"}
            </button>

          </div>

        </form>
      </div>
    </div>
  );
}

export default AddRoomModal;