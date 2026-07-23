/**
 * @file cmd_mux.cpp
 * @brief Implementation of command multiplexer
 */

#include "agv_control/cmd_mux.h"
#include <algorithm>

namespace agv_control
{

CmdMux::CmdMux()
{
  // Initialize all slots with zero velocity
  for (auto & slot : slots_) {
    slot.cmd.linear.x = 0.0;
    slot.cmd.linear.y = 0.0;
    slot.cmd.linear.z = 0.0;
    slot.cmd.angular.x = 0.0;
    slot.cmd.angular.y = 0.0;
    slot.cmd.angular.z = 0.0;
  }

  // Safety commands never expire
  slots_[static_cast<size_t>(CmdSource::SAFETY)].timeout_ms = 0;
}

void CmdMux::submit(const geometry_msgs::msg::Twist & cmd, CmdSource source)
{
  std::lock_guard<std::mutex> lock(mutex_);
  auto idx = static_cast<size_t>(source);
  slots_[idx].cmd = cmd;
  slots_[idx].timestamp = std::chrono::system_clock::now();
  slots_[idx].active = true;
}

geometry_msgs::msg::Twist CmdMux::get_effective() const
{
  std::lock_guard<std::mutex> lock(mutex_);

  // Force stop overrides everything
  if (force_stop_.load()) {
    geometry_msgs::msg::Twist zero;
    return zero;
  }

  // Find highest priority active, non-expired command
  for (size_t i = 0; i < 4; ++i) {
    if (slots_[i].active && !is_expired(slots_[i])) {
      return slots_[i].cmd;
    }
  }

  // No active command - return zero velocity
  geometry_msgs::msg::Twist zero;
  return zero;
}

void CmdMux::force_stop()
{
  force_stop_.store(true);
}

void CmdMux::clear_stop()
{
  force_stop_.store(false);
}

void CmdMux::set_timeout(CmdSource source, int64_t timeout_ms)
{
  std::lock_guard<std::mutex> lock(mutex_);
  auto idx = static_cast<size_t>(source);
  slots_[idx].timeout_ms = timeout_ms;
}

bool CmdMux::is_expired(const CmdSlot & slot) const
{
  if (slot.timeout_ms <= 0) return false;  // Never expires
  auto now = std::chrono::system_clock::now();
  auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
    now - slot.timestamp).count();
  return elapsed > slot.timeout_ms;
}

}  // namespace agv_control
