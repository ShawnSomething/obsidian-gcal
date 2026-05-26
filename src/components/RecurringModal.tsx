import React from "react";

interface RecurringModalProps {
  eventTitle: string;
  title?: string;
  hideThis?: boolean;
  hideFollowing?: boolean;
  showAll?: boolean;
  onChoice: (choice: "this" | "following" | "all" | null) => void;
}

export function RecurringModal({
  eventTitle,
  title = "Edit recurring event",
  hideThis = false,
  hideFollowing = false,
  showAll = false,
  onChoice,
}: RecurringModalProps) {
  return (
    <div className="gcal-modal-backdrop" onClick={() => onChoice(null)}>
      <div className="gcal-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="gcal-modal-title">{title}</h3>
        <p className="gcal-modal-subtitle">"{eventTitle}"</p>

        <div className="gcal-modal-options">
          {!hideThis && (
            <button className="gcal-modal-option" onClick={() => onChoice("this")}>
              <span className="gcal-modal-option-label">This event</span>
              <span className="gcal-modal-option-desc">
                Only this occurrence will be changed.
              </span>
            </button>
          )}

          {!hideFollowing && (
            <button className="gcal-modal-option" onClick={() => onChoice("following")}>
              <span className="gcal-modal-option-label">This and following events</span>
              <span className="gcal-modal-option-desc">
                This and all future occurrences will be changed.
              </span>
            </button>
          )}

          {showAll && (
            <button className="gcal-modal-option" onClick={() => onChoice("all")}>
              <span className="gcal-modal-option-label">All events</span>
              <span className="gcal-modal-option-desc">
                All occurrences in this series will be changed.
              </span>
            </button>
          )}
        </div>

        <div className="gcal-modal-footer">
          <button className="gcal-modal-cancel" onClick={() => onChoice(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}