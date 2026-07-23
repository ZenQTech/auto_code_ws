/**
 * @file cmd_mux.h
 * @brief Command multiplexer - safety override for cmd_vel
 *
 * Implements priority-based command multiplexing:
 *   Priority 1 (highest): Safety watchdog override
 *   Priority 2: Local planner
 *   Priority 3: Global planner / direct control
 */

#ifndef AGV_CONTROL__CMD_MUX_H_
#define AGV_CONTROL__CMD_MUX_H_

#include <string>
#include <atomic>
#include <mutex>
#include <chrono>
#include <geometry_msgs/msg/twist.hpp>

namespace agv_control
{

/// Command source with priority
enum class CmdSource : uint8_t
{
  SAFETY = 0,      // Highest priority - safety override
  LOCAL_PLANNER = 1,
  GLOBAL_PLANNER = 2,
  MANUAL = 3,      // Lowest priority
  NONE = 99,
};

/// Command multiplexer
class CmdMux
{
public:
  CmdMux();

  /// Submit a velocity command from a specific source
  void submit(const geometry_msgs::msg::Twist & cmd, CmdSource source);

  /// Get the current effective command (highest priority non-expired)
  geometry_msgs::msg::Twist get_effective() const;

  /// Force stop (safety override - bypasses all)
  void force_stop();

  /// Check if force stop is active
  bool is_stopped() const { return force_stop_.load(); }

  /// Clear force stop
  void clear_stop();

  /// Set timeout for a source (milliseconds)
  void set_timeout(CmdSource source, int64_t timeout_ms);

private:
  struct CmdSlot
  {
    geometry_msgs::msg::Twist cmd;
    std::chrono::system_clock::time_point timestamp;
    int64_t timeout_ms{1000};  // Default 1s timeout
    bool active{false};
  };

  CmdSlot slots_[4];  // Indexed by CmdSource
  mutable std::mutex mutex_;
  std::atomic<bool> force_stop_{false};

  /// Check if a slot has expired
  bool is_expired(const CmdSlot & slot) const;
};

}  // namespace agv_control

#endif  // AGV_CONTROL__CMD_MUX_H_
