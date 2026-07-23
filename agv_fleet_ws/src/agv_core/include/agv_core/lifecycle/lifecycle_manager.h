/**
 * @file lifecycle_manager.h
 * @brief Lifecycle management for AGV nodes
 *
 * Manages node states: UNCONFIGURED -> INACTIVE -> ACTIVE -> ERROR
 * Implements safe startup/shutdown sequences for AGV onboard nodes.
 */

#ifndef AGV_CORE__LIFECYCLE__LIFECYCLE_MANAGER_H_
#define AGV_CORE__LIFECYCLE__LIFECYCLE_MANAGER_H_

#include <string>
#include <functional>
#include <atomic>
#include <mutex>

namespace agv_core
{
namespace lifecycle
{

/// Lifecycle states
enum class State : uint8_t
{
  UNCONFIGURED = 0,
  INACTIVE = 1,
  ACTIVE = 2,
  ERROR = 3,
  SHUTDOWN = 4,
};

/// Lifecycle transition events
enum class Transition : uint8_t
{
  CONFIGURE = 0,
  ACTIVATE = 1,
  DEACTIVATE = 2,
  CLEANUP = 3,
  SHUTDOWN = 4,
  ERROR = 5,
};

/// Callback type for lifecycle transitions
using TransitionCallback = std::function<bool()>;

/// Lifecycle manager for a single node
class LifecycleManager
{
public:
  LifecycleManager() = default;
  ~LifecycleManager() = default;

  /// Register a callback for a specific transition
  void register_callback(Transition transition, TransitionCallback callback);

  /// Trigger a state transition
  /// Returns true if the transition is valid and all callbacks succeed
  bool trigger_transition(Transition transition);

  /// Get current state
  State get_state() const { return current_state_.load(); }

  /// Get current state as string
  std::string state_string() const;

  /// Check if in active state
  bool is_active() const { return current_state_.load() == State::ACTIVE; }

  /// Check if in error state
  bool is_error() const { return current_state_.load() == State::ERROR; }

private:
  /// Validate if a transition is allowed from the current state
  bool is_valid_transition(Transition transition) const;

  std::atomic<State> current_state_{State::UNCONFIGURED};
  TransitionCallback callbacks_[6];  // indexed by Transition enum
  mutable std::mutex mutex_;
};

}  // namespace lifecycle
}  // namespace agv_core

#endif  // AGV_CORE__LIFECYCLE__LIFECYCLE_MANAGER_H_
