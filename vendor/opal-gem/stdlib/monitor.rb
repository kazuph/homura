# frozen_string_literal: true

require "thread"

class Monitor
  def initialize
    @mutex = Mutex.new
  end

  def synchronize
    @mutex.synchronize { yield }
  end
end
