/**
 * @file lifecycle_manager.cpp
 * @brief Implementation of lifecycle manager for AGV nodes
 */

#include "agv_core/lifecycle/lifecycle_manager.h"
#include <stdexcept>

namespace agv_core
{
namespace lifecycle
{

void LifecycleManager::register_callback(Transition transition,
                                         TransitionCallback callback)
{
  std::lock_guard<std::mutex> lock(mutex_);
  auto idx = static_cast<size_t>(transition);
  if (idx >= 6) {
    throw std::out_of_range("Invalid transition index");
  }
  callbacks_[idx] = std::move(callback);
}

bool LifecycleManager::trigger_transition(Transition transition)
{
  if (!is_valid_transition(transition)) {
    return false;
  }

  // Execute registered callbacks
  auto idx = static_cast<size_t>(transition);
  if (callbacks_[idx]) {
    if (!callbacks_[idx]()) {
      // Transition callback failed - enter error state
      current_state_.store(State::ERROR);
      return false;
    }
  }

  // Perform state transition
  switch (transition) {
    case Transition::CONFIGURE:
      current_state_.store(State::INACTIVE);
      break;
    case Transition::ACTIVATE:
      current_state_.store(State::ACTIVE);
      break;
    case Transition::DEACTIVATE:
      current_state_.store(State::INACTIVE);
      break;
    case Transition::CLEANUP:
      current_state_.store(State::UNCONFIGURED);
      break;
    case Transition::SHUTDOWN:
      current_state_.store(State::SHUTDOWN);
      break;
    case Transition::ERROR:
      current_state_.store(State::ERROR);
      break;
  }

  return true;
}

std::string LifecycleManager::state_string() const
{
  switch (current_state_.load()) {
    case State::UNCONFIGURED: return "UNCONFIGURED";
    case State::INACTIVE:     return "INACTIVE";
    case State::ACTIVE:       return "ACTIVE";
    case State::ERROR:        return "ERROR";
    case State::SHUTDOWN:     return "SHUTDOWN";
    default:                  return "UNKNOWN";
  }
}

bool LifecycleManager::is_valid_transition(Transition transition) const
{
  State current = current_state_.load();

  switch (transition) {
    case Transition::CONFIGURE:
      return current == State::UNCONFIGURED;
    case Transition::ACTIVATE:
      return current == State::INACTIVE;
    case Transition::DEACTIVATE:
      return current == State::ACTIVE;
    case Transition::CLEANUP:
      return current == State::INACTIVE || current == State::ERROR;
    case Transition::SHUTDOWN:
      return true;  // Shutdown from any state
    case Transition::ERROR:
      return current != State::SHUTDOWN;
    default:
      return false;
  }
}

}  // namespace lifecycle
}  // namespace agv_core
